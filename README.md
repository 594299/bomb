# 数字炸弹 · 部署文档

## 架构

```
玩家浏览器 ──WebRTC直连── 玩家浏览器   （猜数/同步全走P2P，服务器不经手对局流量）
     │
     ├── /peerjs     PeerJS 信令（云托管）——只负责P2P握手
     ├── /api/lobby  大厅房间列表（云托管 REST，内存存储，3分钟心跳过期）
     └── /api/bans   封禁名单（云托管 REST + 云数据库 bomb_bans 集合持久化）
```

- 前端：纯静态（`index.html` + `ai-*.js` + `haododoya/admin.html`），部署在 CloudBase 静态网站托管
- 后端：`bomb-backend/server.js`（Express + PeerServer），部署在 CloudBase 云托管（容器型）
- 封禁名单五副本：localStorage + IndexedDB + Cache + Cookie（客户端四处）+ 云数据库（第五副本，根治"清除全部网站数据"）

## 部署步骤

### 1. 后端（云托管）

```bash
cd bomb-backend
# 通过 IDE 的 CloudBase 集成一键部署（manageCloudRun deploy），或控制台：
# 云开发控制台 → 云托管 → 新建服务 → 本地代码上传 → 选择 bomb-backend 目录（含 Dockerfile）
```

- 服务名：`bomb-server`
- 端口：80（Dockerfile 已配 `ENV PORT=80`）
- 规格：0.25核 / 0.5GB，MinNum=1（避免冷启动）
- 环境变量：`ADMIN_TOKEN=你的管理令牌`（管理页推送封禁名单用，务必设置）
- 部署后得到地址：`https://bomb-server-xxxxxxx.gz.tencentacle.com`（以实际返回为准）

### 2. 云数据库

创建集合 `bomb_bans`（文档型 NoSQL），权限设为"仅管理端可读写"（云托管内免密钥调用，无需开放给客户端）。

### 3. 前端

部署前把后端地址填进两个文件：

- `index.html` 顶部：`const BOMB_SERVER_URL = 'https://你的云托管地址';`
- `haododoya/admin.html` 中 `saveBanData` 附近：同样的 `BOMB_SERVER_URL`
- 管理页推送令牌：浏览器控制台执行一次 `localStorage.setItem('bomb_admin_token','你的管理令牌')`

然后把以下文件上传到 CloudBase 静态网站托管根目录：

- `index.html`
- `ai.js` `ai-brain.js` `ai-observe.js` `ai-skills.js` `ai-strategy.js`
- `ai-easy.js` `ai-normal.js` `ai-hard.js` `ai-master.js` `ai-persona.js`
- `haododoya/admin.html`（保持目录结构）

### 4. 后端 API 一览

| 接口 | 说明 |
|---|---|
| `GET /` | 健康检查（含房间/封禁计数） |
| `/peerjs` | PeerJS 信令（WebSocket） |
| `GET /api/lobby` | 大厅房间列表 |
| `POST /api/lobby/publish` | 房主发布/心跳房间卡（30秒一次） |
| `DELETE /api/lobby/:code` | 撤下房间卡 |
| `GET /api/bans/check?fp&dc&ip` | 封禁查询（客户端自检 + 房主联机闸复检） |
| `POST /api/bans/report` | 举报上报（限流 10次/分/IP） |
| `POST /api/bans/sync` | 管理页整包推送（需 `x-admin-token`） |
| `GET /api/bans` | 查看完整名单（需令牌） |
| `POST /api/bans/unban` | 解封 `{type:'fp'/'dc'/'ip', value}`（需令牌） |

## 关键设计

- **降级哲学**：`BOMB_SERVER_URL` 留空时游戏完全走公共通道（公共PeerJS+公共MQTT+本地名单），后端挂了游戏照玩
- **信令优先自建**：`PEER_SERVERS` 列表自建排第一，公共服务器兜底
- **大厅三通道**：自建后端 + MQTT + listAllPeers 并行取并集
- **封禁云校验**：本地闸放行后异步云端复检，命中即踢并复活本地名单
