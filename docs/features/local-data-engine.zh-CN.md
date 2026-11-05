# 本地整场归档、对手采集与训练

此功能先支持本机。Chrome扩展持续读取浏览器已经接收到的直播数据，经IndexedDB待写队列落盘到SQLite；数据不会因原有分钟分析档案到期而自动删除。它归档事件与协议证据，不是音视频录制器，也不能读取平台未公开/未下发的资料。

## 安装与启用

在项目目录运行（Python3.11或更新版本；此组件不需要FFmpeg、pip安装或云API）：

```sh
npm run data:install -- --extension-id=chrome扩展ID --python=/实际路径/python3
```

扩展ID见 `chrome://extensions`。自动安装器支持macOS/Linux的Google Chrome。Windows和其他Chromium发行版暂未做原生宿主注册验收。

重新加载 `dist/chrome-extension` 扩展并刷新本房直播页，打开扩展图标 →「本地数据归档与对手采集」→「启用本地整场归档」。状态显示待写条数、已经落盘条数和实际数据库位置；未安装时会明确报错。后台会在新事件/覆盖心跳到来时重试；也可点击「检查连接并继续落盘」。

默认文件：`~/.local/share/douyin-live-assistant/data/live.sqlite3`。macOS完整示例为 `/Users/你的用户名/.local/share/douyin-live-assistant/data/live.sqlite3`。宿主安装在相邻的 `data-host/`，与原音视频感知宿主分开。`--uninstall` 只卸载组件，**保留数据库**。

本次安装在当前机器时自动核对了已有扩展的ID；没有启用真实直播归档、打开真实对手房间或发送实播互动。

## 对手只读采集

在本房扩展图标菜单填写对手的房间号或直播链接，然后点击「打开对手只读采集页」。最多同时打开3个；重复请求复用本房已有采集页。独立页读取弹幕、礼物、PK和其他现有协议观测，保存原始证据，**不初始化场控或互动发送器**。遇到登录/平台验证请在浏览器正常处理；等待、断连、关闭页面都会形成缺测。

「停止本房发起的对手采集」只关闭仍保持原采集地址的本工具标签；已经被用户导航到其他地址的标签保留。浏览器重启/后台worker重启不会依靠内存猜测标签归属，使用会话存储核对。自动从PK主播UID发现房间号尚未实现。

暂停新增归档不会删除已落盘记录或待写队列。恢复归档后重试待写数据；暂停期间的新数据不被补造。恢复journal与长期数据仓库是两套存储：预测页原有清空/排除操作仍管理原有分析档案，不等同于删除SQLite原始证据。若要删除整场原始数据，请先备份，再明确管理本地数据库文件。

## 查询、备份与导出

以下命令在项目目录执行；可加 `--database=/其他位置/live.sqlite3` 读取其他数据库。输出文件使用新文件名，不覆盖已有导出/备份。

```sh
python3 native/data_host.py status
python3 native/data_host.py summary --room=本房间号
python3 native/data_host.py export --room=本房间号 --output=events.jsonl
python3 native/data_host.py dataset --room=本房间号 --output=numeric-training.jsonl
python3 native/data_host.py pk-dataset --room=本房间号 --output=pk-training.jsonl
python3 native/data_host.py audience --room=本房间号 --user=uid:已观察观众UID
python3 native/data_host.py backup --output=live-backup.sqlite3
```

导出逐行流式写出，不把整库装入内存。备份使用SQLite online backup，不直接复制可能仍在WAL中的数据库主文件。数据库设置WAL、FULL同步、事务批次及房间/时间/用户索引；多个原生进程由SQLite串行写入，扩展只有后台一个队列所有者。

协议大帧以相同批次/帧序号的 `part` / `parts` 分片保存，按序拼接 `rawBase64` 后再解码。事件、原帧、公开账号采集、预测、覆盖、PK状态分类型保存。原始礼物消息包含连击累计更新和重复观测，不要直接把 `count` 相加当收入。

`audience` 只处理已观察稳定UID/secUid；当前兴趣词典限定音乐、游戏、美食、运动、数码，并要求明确表达，保留原话、时间与记录ID。没有表达就返回空数组。消息计数不表示真实在线时长、消费金额或财力。未采集的关注列表、私密资料和潜水观众没有被获取。

## 本机训练与推理

```sh
python3 native/data_host.py train --room=本房间号 --anchor=主播UID --target=diamonds --horizon=5
python3 native/data_host.py train --room=本房间号 --anchor=主播UID --target=online --horizon=1
```

`diamonds` 对应未来5分钟已知价格礼物增量；`online` 对应已有1/5/15分钟人数预测。训练使用曾经发布并在到期后有有效实测标签的样本，不用未发布的回填预测。至少50个不重叠样本，按时间60/20/20切分并清洗跨界标签，各段至少10条。两段留出MAE都改善至少5%才启用。样本不足返回 `insufficient-data`，不强行训练。

当前模型是无需额外包的残差校准器，负责纠正已有数值预测的稳定偏差；测试集覆盖率是实测指标，未来并不保证80%。本机独立推理返回带目标、窗口、训练时间和验证指标的候选，AI接收有界候选与仓库事实摘要，原始图表和发布记录仍保留原始数值。尚未训练CatBoost/LightGBM/Chronos，也没有宣称真实准确率已提升。

PK数据集保留同一战局不同剩余时间桶的概率，只有已确认终局才有标签。后续训练按 `battleKey` 分组与时间切分，不能把同一战局拆到训练和测试；当前并未自动训练PK分类器。

## 运行与容量边界

- 扩展待写缓冲上限256MiB；未确认批次不会为腾空间删除。到达上限会停止确认新桥接批次并显示故障，MAIN自身仍有有界队列，持续满载仍可能造成可见缺口。恢复组件/磁盘后重试，不承诺无限断线缓存。
- SQLite无自动清除规则，整场协议数据可能较大；请定期查看 `status` 的字节数并做备份/归档。原有分析档案的45天/30天保留策略不控制此数据库。
- 关闭浏览器、睡眠、标签被丢弃、平台验证或接口变更会中断采集；对手页沿用现有保活租约，但本次没有真实直播多日压力验收。
- 数据库只在本机，文件权限600，安装目录700；没有开放HTTP数据库端口。正常分析/AI仅取得有界数值摘要，API密钥/请求Cookie等凭据字段不属于归档接口。
- 本次界面仅扩展现有扩展图标菜单，复用原表单、滚动和字号；没有改变工作台共享布局。浏览器检查为本地夹具，Chrome原生组件注册和真实Python stdio链路已检查（未用实播验证Chrome端到端），完整实播采集仍待用户启用后积累证据。

选型和后续路线见 [2026-11-05调研](../research/local-live-data-engine-2026-11-05.zh-CN.md)。
