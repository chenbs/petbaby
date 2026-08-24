# Petbaby Platform

移动端优先的 Next.js 单体应用，包含 Web/H5、REST API、PostgreSQL/PGlite、图片/视频生成 Worker、支付、对象存储和运营后台。

## 本地运行

```powershell
pnpm install
pnpm dev
```

打开 `http://localhost:3000`。本地模式使用匿名账户、磁盘持久化 PGlite 数据库、私有文件存储和模拟支付；数据写入未跟踪的 `.data/` 目录，服务重启后仍保留。

## 检查命令

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
pnpm worker
pnpm db:migrate
```

生产部署使用 PostgreSQL，`pnpm worker` 同时处理图片生成、FFmpeg 视频、订阅消息和周期维护。上线前必须补齐对象存储、微信登录/支付和 HTTPS 域名，不得启用模拟支付。

`/api/health` 提供数据库与队列健康状态；`/api/internal/maintenance` 负责订单关闭、免费作品和孤立文件清理。只有维护入口需要 `WORKER_SECRET`，健康检查接口供容器和负载均衡直接探测。

完整部署方法、推荐配置和回滚流程见 `../../docs/delivery/02-deployment-guide.md`；环境变量见 `../../docs/delivery/04-environment-reference.md`。

`scripts/smoke.ts` 是部署后的主链路自检（注册 → 上传 → 生成 → 解锁 → 分享 → 清理），在部署机上通过 `deploy/scripts/smoke-test.sh` 调用。
