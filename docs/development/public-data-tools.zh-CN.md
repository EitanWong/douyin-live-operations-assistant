# 公共数据工具与免费接口

核实日期：2026-11-07。直播问答、端侧问答和私有问答测试共用 `createAIClient` 的工具路由；后台研究 Agent 由 LangGraph 动作调用同一套公共数据/天气客户端。当前时间直接读取运行时钟；其余工具直接请求固定公开接口，不需要搜索 API Key。工具返回来源、查询时间及有界摘要，再使用来源回答链路生成正文；公屏不显示内部工具 JSON。

## 已接入

| 能力 | 数据来源 / 接口 | 免密钥与使用范围 | 数据边界 |
| --- | --- | --- | --- |
| 时间、日期、星期、指定时区 | 系统时钟 + `Intl.DateTimeFormat` | 本机，不访问网络 | 默认北京时间；每次调用刷新，不缓存时间答案；取决于本机时钟是否准确 |
| 天气、当前气温 | [Open-Meteo](https://open-meteo.com/) `/v1/forecast` | 无 Key；[官方源码说明](https://github.com/open-meteo/open-meteo)限定托管免费服务为非商用，商业用途应自建或购买相应授权 | 先定位再查日期；当前值是模型估算，全天值是预报；不把不同地点或日期混用 |
| 地名、坐标、行政区域、时区 | [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) `/v1/search` | 无 Key；使用托管服务须遵守 Open-Meteo 条款 | 精确地名匹配并按行政级别区分；无法消解的同名地点先澄清，不根据昵称推测位置 |
| 空气质量 | [Open-Meteo Air Quality](https://open-meteo.com/en/docs/air-quality-api) `/v1/air-quality` | 无 Key；同上，保留 Open-Meteo/CAMS 归属 | 先定位，再取 US AQI、PM2.5、PM10；明确美国 AQI 标准、μg/m³及模型估算，不说成中国 AQI 或监测站实测 |
| 汇率换算、历史参考汇率 | [Frankfurter](https://frankfurter.dev/) `/v2/rate/{base}/{quote}` | 无 Key；官网允许汇总汇率商用；无月/日固定配额，但有防滥用限流 | 使用服务给出的参考日期；非实时成交价或银行换汇价；历史查询可能取此前最近交易日 |
| 中国节假日与调休 | [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn) `master/{year}.json` | 公开静态 JSON，MIT；保留原始数据链接，不复制或修改上游数据 | 按国务院公告整理；分开放假与调休上班；未记录不能推断工作日，周末连休可能不列入；12月还可能受下一年文件影响 |
| 其他国家节假日 | [Nager.Date](https://github.com/nager/Nager.Date) `/api/v3/PublicHolidays/{year}/{countryCode}` | 本次实测旧公开 v3 无 Key 可用；上游新 v4 文档可见，但本机访问403，因此未切换 | 保留国家、全国/地方范围和 Public/Bank/Optional 等类别；不是所有纪念日都放假；地区与个人排班不能推断 |

“公开可访问”“免密钥”“可免费商用”是不同条件。当前天气与空气质量的托管免费服务明确有非商用限制，不应将此清单称作无限制免费商用服务。公共服务可能限流或停服；工具报错会保留诊断，在搜索已启用时尝试网页补查，不编造结果。

## 调用协议

当前时间使用 `{"intent":"clock","timeZone":"Asia/Shanghai"}`。天气使用 `{"intent":"weather","location":"横店","region":"浙江","date":"today","period":"day"}`；`date` 可为 `today`、`tomorrow`、`day-after-tomorrow` 或 ISO 日期，`period=current` 查询当前气温。

其他公共工具使用 `{"intent":"public-data","call":{...}}`。`public-data.js` 的 `PUBLIC_DATA_TOOLS` 是共享工具清单，`publicCallSchema` 是参数契约；云端和端侧都获得相同工具说明。

```json
{"intent":"public-data","call":{"tool":"exchange-rate","base":"CNY","quote":"USD","amount":100,"date":"latest"}}
{"intent":"public-data","call":{"tool":"holidays","countryCode":"CN","year":2026,"date":"2026-10-10","name":""}}
{"intent":"public-data","call":{"tool":"air-quality","location":"横店","region":"浙江"}}
{"intent":"public-data","call":{"tool":"geocode","location":"横店","region":"浙江"}}
```

后台 Agent 使用同一协议，通常一次模型路由、一次公共接口工具执行、一次有来源的答案生成。地点型工具内部先查坐标再查数据，不让模型凭记忆填写横店坐标。公共 GET 不携带模型密钥、Cookie 或直播上下文，不计为模型调用；仍遵守问答取消、后续模型额度和总时限。多个查询各有独立 AbortSignal，不共享在途可变结果。工具结果不进入普通网页知识缓存，避免字段、时区或来源口径被混用。

扩展后台只接受登记的 HTTPS 域名、路径和参数；不接受模型指定任意 URL、认证参数、额外端口或重定向。新增接口需先补失败行为回归，再添加参数 schema、URL 校验、数据解析、来源摘要和扩展域名声明。不要只将公共 API 名称写入提示而缺少实际传输实现。

## 实测与未采用接口

真实公开接口已验证：浙江金华横店定位和天气、横店空气质量、CNY/USD 汇率、中国2026年国庆调休、美国2026年感恩节。回归还覆盖错误地点/行政区/日期、缺失或错误单位、畸形与过期数据、同名地点澄清、实际取消、扩展后台校验及 Agent 两次模型调用的来源交付。网络结果仅证明核实时可用，不代表永久可用或已完成付费模型/真实直播验收。

| 本次核实但未接入 | 原因 |
| --- | --- |
| [REST Countries v3](https://restcountries.com/) | 实际返回200但正文提示该版已废弃；不能仅按HTTP200认为工具成功 |
| [节假日API](https://www.jiejiariapi.com/) | 匿名每日50次，免费版仅供个人测试学习、禁止商用；中国节假日改用公开MIT数据集 |
| Nager.Date v4 | 新文档提供接口，但本机实测403；保留已实际可用的v3，未声称v4已接通 |

## 术语

- 工具清单：允许模型选择的命名能力与参数示例，不是任意网络访问权。
- 来源摘要：从已验证接口字段生成的有界资料，模型只能据其实际范围回答。
- 当前值：有明确观测/模型时刻的数据；过期或未覆盖时不可当作现在。
- 预报值：对指定日期的预测，不等于实测。
- 参考汇率：服务商注明日期的日参考值，不是可成交报价。
- 视觉可用：近期已完成的 `video` / `omni` 识别仍有效，原文随上下文传入；不等于持续录像或人物身份认证。

穿着问题从当前视觉证据回答，不调用外部公共API。独立视觉、分段Omni、WebRTC和原生宿主均记录可见衣服种类、颜色、配饰及遮挡；连续语音与端侧预算不能删除最新有效画面。没有画面或相关细节确实不可见时才说明具体缺口。

## 2026-11-05 天气容错补充

Open-Meteo 的16天响应可能在远期日期含空值；程序只对所问日期的天气码、温度、降水概率做值校验，保留数组长度、单位和时区校验。所问日期本身无效仍不能回答。

全天预报在主接口失败或超时后，使用已核验坐标请求 [wttr.in JSON 接口](https://github.com/chubin/wttr.in#json-output)，固定路径 `https://wttr.in/{latitude},{longitude}?format=j1`。该公开接口无需密钥；数据标注 wttr.in / WorldWeatherOnline，不能将服务端开源许可证当作上游气象数据的无限制商用许可，使用需遵守上游条款及限流。主接口只用定位后剩余时间的一半，给备用接口留出时间，总查询仍受8秒上限和取消约束。

备用响应必须覆盖目标日期，最近地点坐标与查询点偏差不超过每轴0.05度，温度、天气码、时段与降雨概率均须有效。摘要使用当日各时段天气和最高降雨概率，不伪装成当前实测。wttr的当前值可能缺少观测日期，故仅用于全天预报；实时气温仍要求有明确时间且不过期的主源数据。地名定位失败、两源均失败时仍使用已有的限定地点日期网页补查，不把邻近地名当作答案。
