# PK 每日任务官方来源：第二轮静态调查

调查日期：2026-10-25，北京时间。承接 `pk-daily-tasks-2026-10-25.zh-CN.md`，本轮只检查已有 APK、官方 Web schema、官方 Lynx 模板及跳转配置，没有操作手机或发送弹幕，也没有重复此前失败的登录请求。

## 当前结论

**仍未取得每日有效 PK、每日有效胜场、每日首胜的真实接口响应。** 本轮补充定位了两个服务端下发的段位页面入口和一类官方段位结算消息；它们有助于下一次被动采集，但不能据此填入每日进度。

用户举例的 `每日首场胜利 (0/1)`、`每日8场有效PK (4/8)`、`每日4场有效PK胜利 (2/4)` 仍只是字段说明，不能当作当前主播的采集结果。

## 新增证据

### 1. 主播 PK 面板存在两类动态入口

官方 `revenue_link_douyin/pages/pk_main_panel/template.js` 把 `/webcast/battle/rivals/recommend/` 的响应映射为：

```js
rankSeasonInfo: response.rank_season_info || {}
pkSeasonInfo: response.pk_season_info || ""
```

第一类：`rank_season_info.detail_scheme`。PK 面板点击段位标题后，将此字段交给原生 `scheme` 打开；`rank_random_match/template.js` 同样使用这个字段。该页面带有「巅峰赛」相关状态，因此尚未证明与用户描述的资料卡段位任务页完全一致。

第二类：`pk_season_info` 为 JSON 字符串。模板通过 `JSON.parse(bannerInfo)` 读取并展示：

| 字段 | 模板中实际用途 |
| --- | --- |
| `has_grade` | 是否已有段位 |
| `first_grade`、`second_grade` | 段位名称与星数 |
| `now_count_str`、`target_count_str` | 有段位时展示进度；无段位时展示「…/…场PK」 |
| `season_status`、`start_time_str` | 未开始状态及开始提示 |
| `grade_img` | 段位图片 |
| `scheme_url` | 点击后的真实跳转地址 |

模板没有把上述 `now_count_str` 命名为「每日有效 PK」。尤其在 `has_grade=false` 时它是段位未激活状态的场数，在 `has_grade=true` 时随段位展示进度。**不能只见到分数形式就当作每日任务。**

此入口和上一轮资料卡 `HonorWallElement.ExtraInfo.scheme` 一样，真实 URL 都来自服务端；此次仍未得到它们的实际值。

### 2. 官方 Web 协议支持段位结算消息

官方 `live-schema-im.e322bd8a.js` 中存在 `BattleSeasonPKResultMessage`；APK `classes53.dex` 的字符串索引 21412 同时存在方法名 `WebcastBattleSeasonPKResultMessage`。

消息字段由官方 decoder 确认：

| Protobuf 字段号 | 字段 | 含义范围 |
| --- | --- | --- |
| 1 | `common` | 通用消息信息 |
| 2 | `pk_result` | 本次结算文案、图片及积分说明 |
| 3 | `upgrade_result` | 段位升级信息 |
| 4 | `get_grade_info` | 获取段位信息 |

`pk_result`：字段 3 `result_str`；字段 4 `descriptions[]`。每条 description：字段 1 `point_desc`（string）、字段 2 `point`（int64）、字段 3 `point_str`（string）。

`upgrade_result`：字段 3 `upgrade_desc`、字段 5 `pre_grade_desc`、字段 6 `after_grade_desc`，以及图片字段。

`get_grade_info`：字段 1 `get_grade_desc`，另有 `grade_img` 和 `start_img`。

该消息可以作为**被动采集段位结算文案**的候选。静态 schema 不证明观众网页会收到它，也不证明 `point_desc` 必然包含首胜或每日进度；本轮没有捕获此消息实例。尤其 `point` 是该条积分说明中的点数，不能映射为有效 PK 场数。

## 搜索边界与排除

- 使用格式化 DEX string table 读取 APK 全部 56 个 DEX，按 `pk season`、`season pk`、每日／首胜／有效 PK、相关 URL 等限定词检查；新增的完整定向结果存于临时目录。未发现一个可验证的固定每日任务读取接口或固定资料卡段位页 URL。这个结论只覆盖字符串搜索，不覆盖所有动态生成路径、加密资源或服务端配置。
- 检查 APK 相关资源成员。内置 `revenue_pk_hybrid_douyin/3770/res.zst` 展开 ZIP 仍只有 `link_control_center/template.js`，没有每日段位任务页。
- 对 `scheme_config.json` 的结构化 `redirect_rules` 检查没有找到 PK season 专用条目。`honor_season_main` / `webcast_privilege_union_season_honor` 指向 `recent_consume_douyin`，配置归属 `privileges`；没有证据把它们认定为主播 PK 段位每日任务，未因此调用无关接口。
- 进行了三组公开网页关键词搜索；没有找到可引用的官方读接口或官方字段说明。第三方段位规则文章不能作为任务进度采集证据，未采用其中规则推算状态。
- REA 的 Android JADX 缺失问题已在上一轮记录，本轮没有安装工具或重复失败调用。本轮证据来自本地格式化 DEX 字符串、官方 JS decoder 与模板，**没有 REA Evidence ID，也没有新增移动端运行抓包证据**。

## 后续采集的具体落点

若已有响应监听可见以下字段，先保存 URL 的来源和主播归属，再读取实际页面中的官方读接口：

1. 资料卡 `HonorWallElement.ExtraInfo.scheme`。
2. `/webcast/battle/rivals/recommend/` 的 `rank_season_info.detail_scheme`。
3. 同响应 `pk_season_info` 解码后的 `scheme_url`。

被动遇到 `WebcastBattleSeasonPKResultMessage` 时，可保留其官方结算描述用于段位播报；只有明确携带每日任务标签、当前值、目标值与可验证日期／主播归属时，才更新每日任务。没有证据的每日有效次数与首胜保持未知，不用本场直播的胜负统计补齐。

上述动态入口的实际值仍是本轮未解项。下一轮最有价值的新增证据，是一份真实资料卡／PK 面板响应或段位页面只读请求，而不是继续猜测接口路径。

## 可复用材料

本轮新增临时文件位于 `/tmp/douyin-pk-task-research/`，可能被系统清理：

- `season-followup-strings.json`：全部 DEX 的 PK season／任务定向字符串（108 项，含少量无关命中）。
- `season-protocol-strings.json`：相关协议与结算类名线索。
- `season-destination-strings.json`：核心 DEX 入口与接口字符串。
- `all-pk-url-strings.json`：全部 DEX 的相关 HTTP URL 字符串。
- `mobile-proto-metadata.json`：内置一组 76 个 schema 元数据条目；没有目标每日任务定义，不能视为全部移动协议。

材料身份：

| 文件 | SHA256 |
| --- | --- |
| `douyin.apk` | `a4e0682ff174d73dbc00d77622037090ee88f164fc0f9b62c324a1234e64ba57` |
| `pk-main-template.js` | `d016e216fbb490573fd77af940556b94960800fb9c0de6787a4114918bd27a7c` |
| `pk-rank-template.js` | `685d23f47d00a57315f218b485009984781e0b156df83306ba8000733bbe6527` |
| `scheme_config.json` | `a2db97d373e5173ba8fc70d452cd3e5aa1633ecfb0fa837ab80eecabff605459` |
| `live-schema-im.e322bd8a.js` | `232a3d3890052ebe868b4b14aca38918730285adbc0f623c77dc8bdaafbc783b` |

官方 JS 来源沿用上一轮已保存材料：

- `https://lf-webcast-gr-sourcecdn.bytegecko.com/obj/byte-gurd-source-gr/webcast/mono/lynx/revenue_link_douyin/pages/pk_main_panel/template.js`
- `https://lf-webcast-gr-sourcecdn.bytegecko.com/obj/byte-gurd-source-gr/webcast/mono/lynx/revenue_pk_panel_lynx_douyin/pages/rank_random_match/template.js`
- `https://lf-webcast-platform.bytetos.com/obj/webcast-platform-cdn/webcast/douyin_live/chunks/live-schema-im.e322bd8a.js`
