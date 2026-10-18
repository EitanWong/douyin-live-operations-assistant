# 互动题库来源与改编

内置 114 道真心话、87 道大冒险。题目在本地打包，不依赖在线题库。

其中 19 道真心话和 26 道大冒险翻译或改编自 [party-game-sentences](https://github.com/itsbrunodev/party-game-sentences)，其余为本项目原创题目。

- 固定版本：`7f512e0c72e46302bcb48e455a98ab91494ad647`
- 原始数据：[src/json/truth-or-dare.json](https://github.com/itsbrunodev/party-game-sentences/blob/7f512e0c72e46302bcb48e455a98ab91494ad647/src/json/truth-or-dare.json)
- 许可证：[MIT](https://github.com/itsbrunodev/party-game-sentences/blob/7f512e0c72e46302bcb48e455a98ab91494ad647/LICENSE)，Copyright (c) 2023 brunolepis。完整许可随题库源码保留，并包含在生成的油猴和扩展脚本中。
- 每条改编题的 `source` 标明原始数组名及从 0 开始的索引，便于追溯。未使用该仓库的其他数据集。

改编将线下表演转换为文字、表情或想象挑战，例如机器人舞改为描述舞步，物品说唱改为编写短句。未引入原题库中的成人、暴露隐私、饮酒、危险动作或打扰陌生人的题目。

分类覆盖日常、兴趣、音乐、旅行、情绪、童年、愿望、朋友、成长、想象与创意表达。每种题型一轮抽完前不重复，跨轮避免连续同题；历史随运行快照恢复。AI 只负责互动表达，本地题目和游戏结果保持一致。
