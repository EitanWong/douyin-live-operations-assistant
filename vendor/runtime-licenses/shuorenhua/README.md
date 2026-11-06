# shuorenhua 回复风格规则

来源：[MrGeDiao/shuorenhua](https://github.com/MrGeDiao/shuorenhua)，MIT，2.6.1。
固定提交：`9b91ed9464b944258c5031993c5e7d5d4e9637a8`，2026-11-07核对。

阅读了 `skills/shuorenhua/SKILL.md` 和 `dist/shuorenhua-mini.md`，按用户要求将保真编辑原则改编为 `src/ai/reply-style.js` 的短回复规则：去除无独有内容的包装，保留事实、责任主体、数字、范围、条件、否定、情态、完成状态、比较关系和来源归属。规则由云端、端侧、搜索回答、修订和研究共用。

没有将整个技能或评测/历史材料放进模型上下文，也没有机械替词、检测AI含量或新增逐条润色模型调用。既有事实核对、工具权限、身份与输出格式优先；该skill是编辑规范，不能独立保证模型准确率或自然度。LICENSE随扩展第三方声明打包。
