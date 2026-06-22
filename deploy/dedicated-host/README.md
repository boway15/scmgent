# 专用 Win11 宿主机部署文件

将 scm-agent 安装到**全新专用电脑**并对外提供 `https://scm.al6s.cn` 时，使用本目录模板 + 主文档。

## 主文档（按顺序操作）

**[docs/dedicated-host-setup-migration.md](../../docs/dedicated-host-setup-migration.md)** — 从零安装、代码/数据库迁移、Docker、cloudflared、Access、验收

补充：[docs/win11-cloudflare-tunnel-deploy.md](../../docs/win11-cloudflare-tunnel-deploy.md)

## 本目录文件

| 文件 | 复制到 |
|------|--------|
| `cloudflared.config.example.yml` | `%USERPROFILE%\.cloudflared\config.yml`（改用户名与 Tunnel ID） |

项目根目录还有：

| 文件 | 复制到 |
|------|--------|
| `docker-compose.public.example.yml` | `docker-compose.public.yml`（改域名与密钥） |

## 最小路径

```powershell
cd D:\scm-agent
copy docker-compose.public.example.yml docker-compose.public.yml
# 编辑 docker-compose.public.yml

docker compose -f docker-compose.yml -f docker-compose.public.yml up -d --build

cloudflared tunnel login
cloudflared tunnel create scm-al6s
copy deploy\dedicated-host\cloudflared.config.example.yml $env:USERPROFILE\.cloudflared\config.yml
notepad $env:USERPROFILE\.cloudflared\config.yml
cloudflared tunnel route dns scm-al6s scm.al6s.cn
cloudflared service install
cloudflared service start
```
