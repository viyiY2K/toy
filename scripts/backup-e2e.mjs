/**
 * Local backup browser regression (v4 §7.14 / §9.4).
 *
 * Start the app separately, then run:
 *   npm run dev -- --host 127.0.0.1 --port 4187
 *   node scripts/backup-e2e.mjs
 *
 * PLAYWRIGHT_MODULE may point to an existing Playwright installation.
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH overrides its bundled browser.
 * BACKUP_E2E_BASE_URL defaults to http://127.0.0.1:4187.
 * BACKUP_E2E_OUTPUT_DIR defaults to a new directory under the system temp dir.
 *
 * Every run creates fresh, nonpersistent browser contexts. Only the operating
 * system save-picker boundary and a deliberate storage failure are mocked;
 * tasks, settings, downloads, confirmation, validation and restoration use UI.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.BACKUP_E2E_BASE_URL || 'http://127.0.0.1:4187';
const outputDir = process.env.BACKUP_E2E_OUTPUT_DIR
  ? path.resolve(process.env.BACKUP_E2E_OUTPUT_DIR)
  : await mkdtemp(path.join(tmpdir(), 'focus-backup-e2e-'));
await mkdir(outputDir, { recursive: true });

const stores = [
  'tasks', 'dayPlans', 'sessions', 'events', 'energyRecords',
  'unresolvedIntervals', 'settings', 'mergeGroups',
];
const results = [];
const pageErrors = [];
let activePage;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
});

function passed(name, details = {}) {
  results.push({ name, status: 'PASS', ...details });
  console.log(`PASS ${name}`);
}

async function eventually(read, predicate, message) {
  const deadline = Date.now() + 10_000;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.fail(`${message}; last value: ${JSON.stringify(value)}`);
}

async function newPage({ fallbackDownload = true } = {}) {
  const context = await browser.newContext({
    acceptDownloads: true, viewport: { width: 1440, height: 1100 },
    locale: 'zh-CN', timezoneId: 'Asia/Tokyo',
  });
  // Never attach to a user's profile or permit authenticated external requests.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL).origin
      || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    // The prototype loads its public React runtime from a CDN.
    if (['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'].includes(url.hostname)) {
      return route.continue();
    }
    return route.abort();
  });
  if (fallbackDownload) {
    await context.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true, writable: true, value: undefined,
      });
    });
  }
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(baseURL);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('专注时长', { exact: true }).waitFor();
  return page;
}

async function database(page) {
  return page.evaluate((names) => new Promise((resolve, reject) => {
    const open = indexedDB.open('pomodoro');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(names, 'readonly');
      const records = {};
      for (const name of names) {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => { records[name] = request.result; };
      }
      tx.oncomplete = () => { db.close(); resolve(records); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), stores);
}

async function goSettings(page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('专注时长', { exact: true }).waitFor();
}

async function createTask(page, title) {
  await page.getByRole('button', { name: /^清单/ }).click();
  const input = page.getByPlaceholder('任务名称，回车创建…', { exact: true });
  await input.fill(title);
  await input.press('Enter');
  await eventually(() => database(page), (data) => data.tasks.some((task) => task.title === title),
    `Task was not created: ${title}`);
  return page.locator('.activity-tree-row').filter({ hasText: title });
}

async function setFocusMinutes(page, value) {
  await goSettings(page);
  const input = page.getByLabel('专注时长', { exact: true });
  await input.fill(String(value));
  await input.press('Tab');
  await eventually(() => database(page), (data) => data.settings.some((settings) => settings.focusMinutes === value),
    'Focus setting did not persist');
}

function backupCard(page) {
  return page.locator('.card').filter({ has: page.getByText('数据导入与导出', { exact: true }) });
}

async function chooseBackup(page, file) {
  const chooser = page.waitForEvent('filechooser');
  await backupCard(page).getByRole('button', { name: '导入数据', exact: true }).click();
  await (await chooser).setFiles(file);
}

async function waitNotice(page, text) {
  const notice = backupCard(page).getByRole('status');
  await notice.filter({ hasText: text }).waitFor();
  return notice.innerText();
}

function assertBackup(backup) {
  assert.equal(backup.kind, 'toy.localBackup');
  assert.equal(backup.format, 'json');
  assert.equal(typeof backup.schemaVersion, 'string');
  assert.ok(Number.isFinite(Date.parse(backup.exportedAt)));
  assert.deepEqual(Object.keys(backup.records).sort(), [...stores].sort());
  assert.equal(backup.totalRecords, stores.reduce((sum, name) => sum + backup.records[name].length, 0));
  for (const name of stores) {
    assert.ok(Array.isArray(backup.records[name]), `${name} must be an array`);
    assert.equal(new Set(backup.records[name].map((record) => record.id)).size, backup.records[name].length);
  }
}

try {
  const page = await newPage();
  const title = 'E2E 备份保留任务';
  const note = '恢复后应保持的备注：中文 / JSON "quoted"';
  const row = await createTask(page, title);
  await row.getByRole('button', { name: '任务详情、备注与层级', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('任务备注', { exact: true }).fill(note);
  await dialog.getByRole('button', { name: '保存备注', exact: true }).click();
  await eventually(() => database(page), (data) => data.tasks.some((task) => task.note === note),
    'Task note did not persist');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();

  const completedRow = await createTask(page, 'E2E 已完成任务');
  await completedRow.getByRole('button', { name: '手动完成', exact: true }).click();
  await eventually(() => database(page), (data) => data.tasks.some((task) => task.status === 'completed'),
    'Manual completion did not persist');
  const deletedRow = await createTask(page, 'E2E 已删除任务');
  await deletedRow.getByRole('button', { name: '软删除', exact: true }).click();
  await eventually(() => database(page), (data) => data.tasks.some((task) => task.deletedAt !== null),
    'Soft deletion did not persist');

  await setFocusMinutes(page, 35);
  await page.getByLabel('累计基数', { exact: true }).fill('7');
  await page.getByRole('button', { name: '确认修改', exact: true }).click();
  await eventually(() => database(page), (data) => data.settings.some((settings) => settings.lifetimePomodoroBaseline === 7),
    'Baseline did not persist');
  const beforeExport = await database(page);
  const downloadPromise = page.waitForEvent('download');
  await backupCard(page).getByRole('button', { name: '导出数据', exact: true }).click();
  const download = await downloadPromise;
  const backupPath = path.join(outputDir, download.suggestedFilename());
  await download.saveAs(backupPath);
  assert.equal(await download.failure(), null);
  await waitNotice(page, '已导出当前数据');
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  assertBackup(backup);
  assert.deepEqual(backup.records, beforeExport, 'Export must include the exact complete snapshot');
  assert.ok(backup.records.tasks.some((task) => task.deletedAt !== null), 'Tombstones must be exported');
  const afterExport = await database(page);
  const exportEvents = afterExport.events.filter((event) => event.type === 'data.exported');
  assert.equal(exportEvents.length, 1);
  assert.deepEqual(exportEvents[0].payload, {
    format: 'json', schemaVersion: backup.schemaVersion, totalRecords: backup.totalRecords,
  });
  passed('UI creates data and browser downloads a complete JSON backup', {
    backupPath, totalRecords: backup.totalRecords,
  });

  await createTask(page, 'E2E 备份之后的新任务');
  await setFocusMinutes(page, 45);
  const beforeRestore = await database(page);
  await chooseBackup(page, backupPath);
  await backupCard(page).getByRole('button', { name: '确认覆盖', exact: true }).waitFor();
  assert.deepEqual(await database(page), beforeRestore, 'Preview must not change data');
  await backupCard(page).getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await backupCard(page).getByRole('button', { name: '确认覆盖', exact: true }).count(), 0);
  assert.deepEqual(await database(page), beforeRestore, 'Cancelling import must not change data');
  passed('Preview and cancelled overwrite preserve every store');

  await chooseBackup(page, backupPath);
  await backupCard(page).getByRole('button', { name: '确认覆盖', exact: true }).waitFor();
  await page.evaluate(() => {
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      // This store is reached after tasks/dayPlans have already queued clears.
      if (this.name === 'events') {
        IDBObjectStore.prototype.add = originalAdd;
        throw new DOMException('E2E injected restore failure', 'DataCloneError');
      }
      return originalAdd.apply(this, args);
    };
  });
  await backupCard(page).getByRole('button', { name: '确认覆盖', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'E2E injected restore failure' }).waitFor();
  assert.deepEqual(await database(page), beforeRestore, 'A failed restore must roll back cleared and inserted records');
  passed('Mid-transaction storage failure rolls back all stores and import audit');

  await backupCard(page).getByRole('button', { name: '确认覆盖', exact: true }).click();
  await waitNotice(page, '已从备份恢复');
  const restored = await database(page);
  for (const name of stores.filter((store) => store !== 'events')) {
    assert.deepEqual(restored[name], backup.records[name], `${name} must preserve original IDs and content`);
  }
  const importedEvents = restored.events.filter((event) => event.type === 'data.imported');
  assert.equal(importedEvents.length, 1);
  assert.deepEqual(importedEvents[0].payload, {
    format: 'json', sourceSchemaVersion: backup.schemaVersion, totalRecords: backup.totalRecords,
  });
  assert.deepEqual(restored.events.filter((event) => event.id !== importedEvents[0].id), backup.records.events,
    'Historical events must remain unchanged');
  assert.equal(restored.events.some((event) => event.type === 'data.cleared'), false);
  await page.reload();
  await goSettings(page);
  assert.equal(await page.getByLabel('专注时长', { exact: true }).inputValue(), '35');
  assert.equal(await page.getByLabel('累计基数', { exact: true }).inputValue(), '7');
  assert.deepEqual(await database(page), restored, 'Reload must preserve restored database');
  await page.getByRole('button', { name: /^清单/ }).click();
  await page.getByText(title, { exact: true }).waitFor();
  assert.equal(await page.getByText('E2E 备份之后的新任务', { exact: true }).count(), 0);
  assert.equal(await page.getByText('E2E 已删除任务', { exact: true }).count(), 0);
  await page.screenshot({ path: path.join(outputDir, 'restored-task-list.png'), fullPage: true });
  passed('Confirmed restore replaces data, preserves IDs/history/tombstones, and survives reload');

  await goSettings(page);
  const missingField = structuredClone(backup);
  delete missingField.records.tasks[0].title;
  const futureVersion = { ...backup, schemaVersion: '999' };
  const mismatchedCount = { ...backup, totalRecords: backup.totalRecords + 1 };
  const missingStore = structuredClone(backup);
  delete missingStore.records.sessions;
  const invalidCases = [
    ['invalid-json', '{invalid JSON', /不是有效的 JSON/],
    ['missing-field', JSON.stringify(missingField), /校验失败/],
    ['future-version', JSON.stringify(futureVersion), /版本.*999/],
    ['mismatched-count', JSON.stringify(mismatchedCount), /记录数对不上/],
    ['missing-store', JSON.stringify(missingStore), /缺少 sessions/],
  ];
  for (const [name, contents, expectedNotice] of invalidCases) {
    const filePath = path.join(outputDir, `${name}.json`);
    await writeFile(filePath, contents);
    const before = await database(page);
    await chooseBackup(page, filePath);
    await waitNotice(page, expectedNotice);
    assert.equal(await backupCard(page).getByRole('button', { name: '确认覆盖', exact: true }).count(), 0,
      `${name} must be rejected before overwrite confirmation`);
    assert.deepEqual(await database(page), before, `${name} must leave every store unchanged`);
    passed(`Rejects ${name} without modifying data`);
  }
  await page.screenshot({ path: path.join(outputDir, 'invalid-backup-rejected.png'), fullPage: true });

  const pickerPage = await newPage({ fallbackDownload: false });
  await createTask(pickerPage, 'E2E 文件选择器任务');
  await goSettings(pickerPage);
  await pickerPage.evaluate(() => {
    window.__backupPicker = { mode: 'success', writes: [], closes: 0, calls: 0 };
    window.showSaveFilePicker = async (options) => {
      const state = window.__backupPicker;
      state.calls += 1;
      state.suggestedName = options.suggestedName;
      if (state.mode === 'cancel') throw new DOMException('Cancelled', 'AbortError');
      return {
        createWritable: async () => ({
          write: async (text) => {
            if (state.mode === 'fail') throw new DOMException('E2E write denied', 'NotAllowedError');
            state.writes.push(text);
          },
          close: async () => {
            if (state.mode === 'close-fail') throw new DOMException('E2E close failed', 'QuotaExceededError');
            state.closes += 1;
          },
        }),
      };
    };
  });
  const beforePickerExport = await database(pickerPage);
  await backupCard(pickerPage).getByRole('button', { name: '导出数据', exact: true }).click();
  await waitNotice(pickerPage, '已导出当前数据');
  const picker = await pickerPage.evaluate(() => window.__backupPicker);
  assert.equal(picker.closes, 1);
  assert.equal(picker.writes.length, 1);
  assert.match(picker.suggestedName, /^toy-backup-.*\.json$/);
  const savedBackup = JSON.parse(picker.writes[0]);
  assertBackup(savedBackup);
  assert.deepEqual(savedBackup.records, beforePickerExport);
  assert.equal((await database(pickerPage)).events.filter((event) => event.type === 'data.exported').length, 1);
  await writeFile(path.join(outputDir, 'picker-export.json'), picker.writes[0]);
  passed('Save picker writes and closes complete JSON before recording export');

  for (const mode of ['cancel', 'fail', 'close-fail']) {
    const before = await database(pickerPage);
    await pickerPage.evaluate((nextMode) => { window.__backupPicker.mode = nextMode; }, mode);
    await backupCard(pickerPage).getByRole('button', { name: '导出数据', exact: true }).click();
    await eventually(
      () => backupCard(pickerPage).getByRole('button', { name: '导出数据', exact: true }).isEnabled(),
      Boolean, 'Export button did not recover after picker outcome',
    );
    if (mode === 'fail') await waitNotice(pickerPage, 'E2E write denied');
    if (mode === 'close-fail') await waitNotice(pickerPage, 'E2E close failed');
    if (mode === 'cancel') assert.equal(await backupCard(pickerPage).getByRole('status').count(), 0);
    assert.deepEqual(await database(pickerPage), before, `${mode} must not append an export audit`);
    passed(`Save picker ${mode} leaves database and export audit unchanged`);
  }

  const activeSourcePage = await newPage();
  await activeSourcePage.getByRole('button', { name: /^清单/ }).click();
  const todayInput = activeSourcePage.getByPlaceholder('直接新建今日任务…', { exact: true });
  await todayInput.fill('E2E 未结束专注备份');
  await todayInput.press('Enter');
  await eventually(() => database(activeSourcePage),
    (data) => data.tasks.some((task) => task.title === 'E2E 未结束专注备份'),
    'Today task did not persist');
  await activeSourcePage.getByRole('button', { name: '计时', exact: true }).click();
  await activeSourcePage.getByRole('button', { name: /^E2E 未结束专注备份/ }).click();
  await activeSourcePage.getByRole('button', { name: '能量 7 / 10', exact: true }).click();
  await activeSourcePage.getByRole('button', { name: '记录能量', exact: true }).click();
  await activeSourcePage.getByRole('button', { name: '开始专注', exact: true }).click();
  const activeData = await eventually(() => database(activeSourcePage),
    (data) => data.sessions.some((session) => session.status === 'active'), 'Focus did not start');
  assert.equal(activeData.energyRecords.length, 1);
  await goSettings(activeSourcePage);
  const activeDownloadPromise = activeSourcePage.waitForEvent('download');
  await backupCard(activeSourcePage).getByRole('button', { name: '导出数据', exact: true }).click();
  const activeDownload = await activeDownloadPromise;
  const activeBackupPath = path.join(outputDir, 'active-focus-backup.json');
  await activeDownload.saveAs(activeBackupPath);
  await waitNotice(activeSourcePage, '已导出当前数据');
  const activeBackup = JSON.parse(await readFile(activeBackupPath, 'utf8'));
  assertBackup(activeBackup);
  assert.equal(activeBackup.records.sessions[0].status, 'active');
  const beforeActiveImport = await database(activeSourcePage);
  await chooseBackup(activeSourcePage, activeBackupPath);
  await backupCard(activeSourcePage).getByRole('button', { name: '确认覆盖', exact: true }).click();
  await activeSourcePage.getByRole('alert').filter({ hasText: '请先结束当前计时' }).waitFor();
  assert.deepEqual(await database(activeSourcePage), beforeActiveImport,
    'An active local timer must block overwrite without changing data');
  passed('Active local timer blocks backup overwrite and preserves all data');

  await activeSourcePage.getByRole('button', { name: '计时', exact: true }).click();
  await activeSourcePage.getByRole('button', { name: '作废本次专注', exact: true }).click();
  await eventually(() => database(activeSourcePage),
    (data) => data.sessions[0].status === 'discarded', 'Focus discard did not persist');
  await goSettings(activeSourcePage);
  await chooseBackup(activeSourcePage, activeBackupPath);
  await backupCard(activeSourcePage).getByRole('button', { name: '确认覆盖', exact: true }).click();
  await activeSourcePage.getByRole('heading', { name: '需要恢复处理', exact: true }).waitFor();
  const samePageRecovery = await database(activeSourcePage);
  assert.deepEqual(samePageRecovery.sessions, activeBackup.records.sessions,
    'Same-page restore must preserve the original unfinished session');
  assert.equal(samePageRecovery.unresolvedIntervals.length, 1);
  assert.equal(samePageRecovery.unresolvedIntervals[0].status, 'pending');
  await activeSourcePage.getByRole('button', { name: '计时', exact: true }).click();
  await activeSourcePage.getByRole('heading', { name: '需要恢复处理', exact: true }).waitFor();
  assert.equal(await activeSourcePage.getByRole('button', { name: '作废本次专注', exact: true }).count(), 0,
    'Restored session must not be treated as a live timer from the current runtime');
  await activeSourcePage.screenshot({ path: path.join(outputDir, 'same-page-focus-recovery.png'), fullPage: true });
  passed('Same-page import after discarding exported focus clears runtime state and opens recovery');

  const recoveredPage = await newPage();
  await chooseBackup(recoveredPage, activeBackupPath);
  await backupCard(recoveredPage).getByRole('button', { name: '确认覆盖', exact: true }).click();
  await recoveredPage.getByRole('heading', { name: '需要恢复处理', exact: true }).waitFor();
  const recoveryData = await database(recoveredPage);
  assert.deepEqual(recoveryData.tasks, activeBackup.records.tasks);
  assert.deepEqual(recoveryData.sessions, activeBackup.records.sessions,
    'Restoring unfinished focus must not infer elapsed duration or completion');
  assert.deepEqual(recoveryData.energyRecords, activeBackup.records.energyRecords);
  assert.equal(recoveryData.unresolvedIntervals.length, 1);
  assert.equal(recoveryData.unresolvedIntervals[0].status, 'pending');
  assert.equal(recoveryData.unresolvedIntervals[0].source, 'appReopened');
  assert.equal(recoveryData.events.filter((event) => event.type === 'data.imported').length, 1);
  assert.equal(recoveryData.events.filter((event) => event.type === 'interval.detected').length, 1);
  assert.deepEqual(recoveryData.events.filter((event) => activeBackup.records.events.some((saved) => saved.id === event.id)),
    activeBackup.records.events, 'Restoration must preserve session and energy history');
  await recoveredPage.getByRole('button', { name: '计时', exact: true }).click();
  await recoveredPage.getByRole('heading', { name: '需要恢复处理', exact: true }).waitFor();
  await recoveredPage.screenshot({ path: path.join(outputDir, 'unfinished-focus-recovery.png'), fullPage: true });
  await recoveredPage.reload();
  await recoveredPage.getByRole('heading', { name: '需要恢复处理', exact: true }).waitFor();
  assert.equal((await database(recoveredPage)).unresolvedIntervals.length, 1,
    'Reload must not duplicate the pending recovery interval');
  passed('Import of unfinished focus restores session/energy and opens one recovery flow');

  const legacyBackup = structuredClone(backup);
  legacyBackup.schemaVersion = '2';
  for (const name of stores) {
    for (const record of legacyBackup.records[name]) {
      record.schemaVersion = 2;
      if (name === 'sessions') delete record.taskSegments;
      if (name === 'mergeGroups') {
        delete record.title;
        delete record.completedAt;
      }
    }
  }
  const legacyBackupPath = path.join(outputDir, 'schema-v2-backup.json');
  await writeFile(legacyBackupPath, JSON.stringify(legacyBackup));
  const migratedPage = await newPage();
  await chooseBackup(migratedPage, legacyBackupPath);
  await backupCard(migratedPage).getByRole('button', { name: '确认覆盖', exact: true }).click();
  await waitNotice(migratedPage, '已从备份恢复');
  const migrated = await database(migratedPage);
  for (const name of stores.filter((store) => store !== 'events')) {
    assert.deepEqual(migrated[name], backup.records[name], `Migration must restore current ${name} shape`);
  }
  assert.deepEqual(migrated.events.filter((event) => event.schemaVersion === 2), legacyBackup.records.events,
    'Migration must not rewrite historical events');
  assert.equal(migrated.events.filter((event) => event.type === 'data.imported').length, 1);
  assert.equal(migrated.events.find((event) => event.type === 'data.imported').payload.sourceSchemaVersion, '2');
  assert.equal(migrated.events.filter((event) => event.type === 'data.migrationCompleted').length, 1);
  assert.deepEqual(migrated.events.find((event) => event.type === 'data.migrationCompleted').payload, {
    fromSchemaVersion: '2', toSchemaVersion: backup.schemaVersion, durationMs: null,
  });
  const upgradedDownloadPromise = migratedPage.waitForEvent('download');
  await backupCard(migratedPage).getByRole('button', { name: '导出数据', exact: true }).click();
  const upgradedDownload = await upgradedDownloadPromise;
  const upgradedPath = path.join(outputDir, 'upgraded-backup.json');
  await upgradedDownload.saveAs(upgradedPath);
  await waitNotice(migratedPage, '已导出当前数据');
  const upgraded = JSON.parse(await readFile(upgradedPath, 'utf8'));
  assertBackup(upgraded);
  assert.equal(upgraded.schemaVersion, backup.schemaVersion);
  assert.deepEqual(upgraded.records, migrated);
  await chooseBackup(migratedPage, upgradedPath);
  await backupCard(migratedPage).getByRole('button', { name: '确认覆盖', exact: true }).click();
  await waitNotice(migratedPage, '已从备份恢复');
  const reimported = await database(migratedPage);
  assert.equal(reimported.events.filter((event) => event.type === 'data.migrationCompleted').length, 1,
    'Reimport of current backup must not invent a second migration');
  assert.equal(reimported.events.filter((event) => event.type === 'data.imported').length, 2);
  assert.deepEqual(reimported.tasks, backup.records.tasks);
  passed('Schema v2 import migrates entities, preserves old events, and re-exports a restorable current backup');

  assert.deepEqual(pageErrors, [], 'Browser must not report unhandled errors');
  await writeFile(path.join(outputDir, 'results.json'), JSON.stringify({
    status: 'PASS', baseURL, browser: await browser.version(), results, pageErrors,
  }, null, 2));
  console.log(`\n${results.length} scenarios passed. Artifacts: ${outputDir}`);
} catch (error) {
  if (activePage) {
    await activePage.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(path.join(outputDir, 'failure-page.txt'), await activePage.locator('body').innerText().catch(() => ''));
  }
  await writeFile(path.join(outputDir, 'results.json'), JSON.stringify({
    status: 'FAIL', baseURL, results, pageErrors, error: String(error.stack || error),
  }, null, 2));
  console.error(`Artifacts: ${outputDir}`);
  throw error;
} finally {
  await browser.close();
}
