# 扩展成语词典

来源：https://github.com/mapull/chinese-dictionary

版本：`e804ada333b68afddfdccbe8dcc938a72da157a7`。

原始文件：`idiom/idiom.json`，49,639 条。SHA-256：`54f0cefb5b7d3ea9a3b357bcd7d53877f5a4c11d1c68ff1790f831800c000ace`。

MIT 许可证见 LICENSE。该开源成语集也收录部分惯用语、口语和异体表达，用于放宽直播接龙的收录范围；不会仅凭四个汉字或 AI 猜测认定为成语。仍可能存在缺漏或读音错误。

使用 `node scripts/update-idioms.mjs` 合并两个固定版本词库；同名词保留原词库读音，再应用已有人工修正。仅导入 4～16 汉字、字数和拼音完整对应的词条。
