# 多端同步：Supabase 项目搭建记录（S2）

这份文档记录"云端那部分"是怎么搭起来的，出问题时可以照着核对，也方便以后换电脑操作。

## 现状

- [x] Supabase 项目已创建，URL：`https://yclemuhlnooaydgbfbuk.supabase.co`
- [x] 登录白名单已配置为 `viyiY2K@gmail.com`（只有这个邮箱能登录，防止陌生人蹭额度）
- [ ] 建表 + 权限规则（`supabase/schema.sql`）——**需要你手动执行一次**
- [ ] 登录跳转网址白名单——留到 S7（要等网站正式发布的网址确定后再配）

## 一、执行建表脚本

1. 打开 [Supabase 控制台](https://supabase.com/dashboard)，进入这个项目。
2. 左侧菜单找到 **SQL Editor**。
3. 新建一个查询，把 [`supabase/schema.sql`](../supabase/schema.sql) 这个文件的全部内容粘贴进去。
4. 点 **Run**。

这个脚本做的事情：
- 建 7 张表，对应"任务清单 / 今日计划 / 专注记录 / 精力记录 / 中断恢复记录 / 设置 / 事件日志"这七类数据。
- 给每张表设了"只能看到/改动自己的数据"的权限规则——即使以后别人（比如白名单外的人）意外拿到了公开的网页链接，也完全看不到、改不了你的数据。
- 明确禁止"物理删除"和"篡改事件日志"——即使程序出 bug，数据库这一层也会硬性拒绝这类操作，不是只靠代码自觉。

脚本可以重复执行（不会因为表已存在而报错），所以以后如果要调整字段，我会更新这个文件，你重新跑一遍即可。

## 二、验证权限规则生效（建议做一次，几分钟）

1. 控制台左侧 **Table Editor**，确认能看到 7 张表：`tasks`、`day_plans`、`sessions`、`energy_records`、`unresolved_intervals`、`settings`、`events`。
2. 控制台左侧 **Authentication** → **Users**，用你的白名单邮箱走一遍登录流程（Supabase 控制台本身有测试登录的入口），确认能拿到一个用户。
3. 非必须但建议：在 **SQL Editor** 里用别的邮箱模拟登录后执行 `select * from tasks`，确认查不到你的数据（因为权限规则按 `user_id` 隔离）。

## 三、关于这两个值是否安全

你给我的：
```
NEXT_PUBLIC_SUPABASE_URL=https://yclemuhlnooaydgbfbuk.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

这两个值本来就是设计给**网页前端公开使用**的（Supabase 官方叫它 "publishable key"，早期版本叫 "anon key"），会被打包进任何人都能看到的网页代码里，这是预期行为、不是泄露。真正保护数据的是上面第一步建的权限规则（RLS）——没有它，光有这两个值确实谁都能读写；有了它，这两个值本身泄露出去也没关系，别人建的账号只能看到别人自己的数据。

**这两个值本身不会被提交进代码仓库**——它们会在下一步（S3）以环境变量的方式接入，届时会专门设置 `.gitignore` 排除，仓库里只留一个占位模板。

## 四、还没做的事

- Magic Link 登录邮件里的跳转链接，需要在 Supabase 后台把"最终网站访问网址"加入白名单，否则点邮件里的链接会跳转失败。这个网址现在还没定（要看网站发布在哪个域名/路径下），留到 S7 一起配置。
