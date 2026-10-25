# PK 段位每日任务：接口调查

调查时间：2026-10-24 晚至 2026-10-25 凌晨，北京时间。

## 目标与结论

用户确认的入口是移动端直播间 → 主播头像 → 用户资料底部「PK 段位」。该页显示段位、当前积分、升级所需积分、观众英雄榜，以及三类每日任务：

| 标签示例 | 含义 |
| --- | --- |
| 每日首场胜利 (0/1)、(1/1) | 每日首胜未完成、已完成 |
| 每日8场有效PK (4/8) | 有效 PK 任务进度 |
| 每日4场有效PK胜利 (2/4) | 有效 PK 胜场任务进度 |

这些数字是用户解释字段时给出的示例，**不是此次采集到的当前主播数据**。任务目标也不应直接硬编码为 8 场和 4 胜。

已定位 Android App 的专用资料卡组件和服务端动态入口字段，但尚未获得这个段位页的实际 URL、每日任务读接口或成功响应。因此此次调查没有把模拟请求接入自动轮询，也没有宣称已经采集到每日任务。

## 已验证的请求

在已有 Chrome 登录会话中，以当前直播间主播为目标执行了以下只读请求；没有导出 Cookie 或手机登录凭据。

1. `GET https://live.douyin.com/webcast/user/profile/`
   - 参数来源：官方 Web `LiveUserProfile.3679af0c.js`。包括 `target_uid`、`sec_target_uid`、`anchor_id`、`sec_anchor_id`、`current_room_id`、`click_source`。
   - `aid=6383&live_id=1&device_platform=web`：`status_code=0`。
   - `data.user_profile.open_area.business_area_v3.bottom_element_list` 为空，没有 PK 段位跳转项。
   - 附加已安装 Android App 的版本信息（40.8.0，versionCode 400801），并将 `device_platform` 改为 `android`：仍能返回资料，但该列表仍为空。
   - 使用源码中存在的可选 `target_identity=2`：仍未返回段位入口。
   - 将 `aid` 改为移动端 `1128`，使用上述 Android 参数：浏览器可见正文为空。没有足够证据判断空响应的具体原因，不能视为认证成功或接口不存在。
2. `GET https://webcast.amemv.com/webcast/battle/rivals/recommend/`
   - 参数来源：官方移动 Lynx `pk_main_panel/template.js`。其中 `entrance=5` 是 `RankSeason`。
   - 手机 UA 的无登录只读请求，以及现有 Chrome 会话中的直接导航，均返回 `status_code=20003`，提示「请登录后进入直播间」。
   - 对应路径在 `live.douyin.com` 返回 404。
   - 它是匹配／段位面板读取路径，不能据此认定就是用户描述的观众侧段位任务接口。

以上是有限参数组合的实测结果，**不能推断所有移动端请求都无法在网页使用**。单独改 UA、平台名或版本参数没有在此次验证中取得目标数据。

## Android 组件证据

从已连接 Android 设备拉取已安装的 `com.ss.android.ugc.aweme` 安装包，仅用于静态分析；没有操作手机界面。

`classes35.dex` 中的类：

```text
com.bytedance.android.live.profile.standard.honour.items.pkseason.PkSeasonHonourCardItem
```

用 Androguard 检查 DEX 指令，确定点击路径：

1. 从 `HonorWallElement` 获取 `ExtraInfo`。
2. 读取 `ExtraInfo.scheme`（该类 `LJ()` 方法返回 `scheme` 字段）。
3. 附加 `user_id`、`anchor_id`、`is_interacting`、`show_user_id`。
4. 交给 `IBaseLiveActionHandler.handle` 打开。

这证明入口地址由服务端资料卡内容下发，不能从组件类名推导固定 URL。对应埋点是 `livesdk_pk_season_card_show` / `livesdk_pk_season_card_click`。

`classes53.dex` 的 `com.bytedance.android.live.profile.repository.NewProfileApi.queryProfile` 注解确认读路径仍为 `/webcast/user/profile/`。移动端有更多资料卡上下文参数，例如 `target_identity`、`target_display_role`、`user_scene`、`special_scene`、`is_my_live`、`current_identity`；仅知道参数名称不代表已经知道正确取值或移动端认证方式。

REA 的 Android 分析因本地缺少配置的 JADX MCP JAR 未成功运行；上述 DEX 结论来自独立的字符串提取和 Androguard 指令分析，没有 REA Evidence ID，也不是 App 运行抓包证据。

## 排除的相似字段

- 官方 Web PK 组件的 `task_info` / `team_task` 是**局内加成挑战**，包含目标值、当前值、加成和本局时段，不能代替每日有效场数或首胜。
- 移动 `pk_task/banner` 的 `/webcast/linkmic/battle/task_info/` 同样包含任务轮次、局内起止时间和 `bonus_ratio`。
- `top_banner` 从原生 `initData` / `onDataChanged` 接收 `banner_area`、`banner_info` 和动态 `scheme_url`，静态模板没有独立每日任务读取请求。
- `battle_power`、`break_through_bar` 是局内表现／闯关组件。部分 GET 路径也会推进状态，未调用这些写操作。
- 直播伴侣 10.0.3 的 ASAR（84 个成员）及其官方远程直播伴侣页面没有找到目标每日任务接口；此有限搜索不排除其他远程页面。
- `BattleUserInfo.user_img_flip_info.scheme` 也是服务端动态入口候选，伴随 `pk_stage_medal`、`pk_stage_desc`；没有拿到实际值，尚未建立它与目标页面的对应关系。
- 「主播任务」`anchor_task_v2/panel` 采用 `/frisbee/task/get_task_list` 通用任务系统；静态内容没有证据将它对应到上述 PK 段位三项任务。

## 下一步所需证据

缺少的是**移动端真实资料卡下发的 PK 段位 `ExtraInfo.scheme`，或打开段位页时的只读网络请求及响应**。获得这一项后，应先提取其官方页面资源，确定接口、主播归属、任务周期与字段，再验证网页现有登录会话能否读取。

接入时需要分别保留首胜进度、有效场数和有效胜场，不用本机观测总场数替代。应校验主播、北京时间日期、采集时间；未提供字段保持未知。跨零点 PK 的任务归属必须以平台任务响应为准。

用户正在手机观看另一位主播；已停止手机镜像尝试，没有切换手机直播间。无需为了继续静态调查占用手机。

## 原始调查材料

本机临时材料（可能随系统清理而丢失）：

- `/tmp/douyin-pk-task-research/`：APK、DEX 字符串索引、官方 PK Lynx/H5 模板、匿名请求结果。
- `/tmp/douyin-pk-task-research/mobile-task-clues/`：局内组件的摘录、下载 URL 与 SHA256。
- `/tmp/douyin-pk-task-web/`：Web PK / Profile 组件、schema，以及独立资料卡调查。
- `/tmp/douyin-pk-mate-research/`：直播伴侣静态调查。

官方资源来源：

- `https://lf-webcast-platform.bytetos.com/obj/webcast-platform-cdn/webcast/douyin_live/chunks/LiveUserProfile.3679af0c.js`
- `https://lf-webcast-gr-sourcecdn.bytegecko.com/obj/byte-gurd-source-gr/webcast/mono/lynx/revenue_link_douyin/pages/pk_main_panel/template.js`
- `https://lf-webcast-gr-sourcecdn.bytegecko.com/obj/byte-gurd-source-gr/webcast/mono/lynx/revenue_pk_panel_lynx_douyin/pages/rank_random_match/template.js`
- `https://webcast.amemv.com/falcon/webcast_douyin/page/pk_task/banner/index.html`
- `https://webcast.amemv.com/falcon/webcast_douyin/page/anchor_task_v2/panel/index.html`
