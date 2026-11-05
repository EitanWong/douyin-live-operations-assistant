---
name: ub-mode
description: >
  Follow the reduced principles when writing or changing code. Every change
  follows First Make it Work, then Then Make it Right, then Follow Practice.
  Use when the user runs /ub-mode or asks for the reduced principles.
---

# ub-mode

本文件适用于整个项目。每次修改默认遵循以下原则，无需额外调用 `/ub-mode`。

Every time you are asked to make a change follow:
* First Make it Work.
* Then Make it Right.
* Follow Practice

# First Make it Work

## Laziness Protocol

* One decision lives in one place.
* Ship the smallest edit that solves the problem.

## Foundational Thinking

* Get the data shape right before you write the logic.
* Do first whatever helps every later phase.
* If a concurrent writer would matter, do not share state.

## TDD

* Write the failing test before you change the code.
* See it fail for the reason you expect.
* Make the smallest change that makes it pass.
* If an honest test is impractical, do not write a bad one.

## Redesign From First Principles

* Do not bolt a new requirement onto the old design.
* Ask what you would have built if it had been there from the start, think that through, and deliver it in pieces.

## Attack the Premise

* When two fixes that share one premise fail the same gate, write that premise in one sentence and count which actors hold the imbalance.
* Remove the assignment.
* Do not start another fix until you have done that.

## Subtract Before You Add

* Take complexity out before you add anything.

## Outcome-Oriented Execution

* Aim at the end state you can check.
* A break in the middle is allowed when you planned it and can undo it.

## Build the Lever

* If the work is not obvious at a glance, build the tool that does it.
* Do one unit by hand, then make the tool match that unit.

## Architecture

### Model the Domain

* Put the domain in a structure that makes the illegal states impossible.
* Maintain a glossary of domain terms.
* If the code is already clear and local, leave it.

### Boundary Discipline

* Check the data where it enters.
* Inside, trust it.
* Keep the business logic in a pure function.

### Type System Discipline

* Make the illegal value impossible to write.
* Parse outside data once, where it comes in.
* Do not silence the compiler.

### Make Operations Idempotent

* Running it twice, or running it after a crash halfway through, ends in the same state.

### Separate Before Serializing Shared State

* If they do not need the same mutable thing, give each its own.
* If they do, allow one writer, and enforce that in the structure.

# Then Make it Right

## Fix Root Causes

* Reproduce it.
* Fix the cause.
* A guard that only hides the crash is not a fix.

## Sequence work into verifiable units

* Finish one small unit and check it.
* Then start the next.

## Test Behavior, Not Implementation

* The test calls the code the way its user does and checks the result that user would see.
* If the test would still pass when every function returned nothing, throw it out.

## Crapper

* Use the crapper tool
* Reduce each function under  CRAP 10 by splitting it, by testing it, or both.
* Consider whether case statements are worth reducing.

## Dryer

* Use the dryer tool to eliminate duplication that rank 0.8 or above.

## Mutator

* Use the mutator tool
* Cover the uncovered.
* Kill the survivors.
* Delete dead code.

## Refactoring

* Pin what the code does.
* Change the structure.
* Prove the behavior did not change.

# Practice

## Keep a Log

* Keep a log of every action you take and the reason you took it.
* Report that log upon completion.

## Guard the Context Window

* Keep the main thread small.
* Send the bulk elsewhere, and keep the summary.

## Worktree Cleanup

* Find what is safe to remove, confirm nothing still in use needs it, then reclaim the disk.
* Uncommitted work waits for a decision.

## Commit and Push

* Commit often, in small ordered commits.
* Each commit says why, what changed, and how you proved it.
* Push to the main line at the end.

# 项目执行约定

* 原则以本文件为唯一来源；新增或调整原则时在此维护。
* 全局布局是新增页面、功能和组件的强制约束，遵循[工作台组件尺寸与排列标准](docs/development/layout-standards.zh-CN.md)。先在共享展示层、尺寸来源和布局边界完成适配，再接入功能；缺少能力时完善共享底层，所有页面复用同一方案，不新增页面专用尺寸补丁、独立高度算法或自制瀑布流。
* 普通卡片遵守同组等高、同行等宽、末行铺满和容器自适应换行；长内容由有界正文滚动或独立放大承接，独立高级折叠区通栏展示。展开、收起、动态内容和窗口拖动缩放不得无限撑高并列卡片、造成交叠或横向溢出；保留原字段、草稿、焦点和键盘顺序，沿用统一过渡与减少动态效果策略，避免逐卡片逐帧测量。
* 涉及界面的功能必须按布局标准完成受影响页面及共享组件的回归：桌面/窄屏、长内容、多处同时展开、反复收起、连续拖动缩放、正文可访问性和性能。共享布局变更需覆盖全部页面及二级分类；验收证据写入行动日志，不能仅凭静态截图或样式断言宣称自适应通过。
* 开发入口见 [Agent 导航与术语](docs/development/agent-guide.zh-CN.md)。先用 `npm run agent:find -- 关键词` 和 `npm run agent:impact -- 文件路径` 定位符号、资源与关联测试；查询的是上次生成的快照，修改后运行 `npm run agent:index` 并提交索引差异。`npm run check` 会拒绝过期索引；索引不替代源码确认与完整回归。
* 每次任务在[行动日志](docs/development/action-log.zh-CN.md)追加执行动作、原因、验证结果及未完成项，完成时报告日志，并补充最终提交与推送结果。
* 按[开发和发布流程](docs/development/release-process.zh-CN.md)执行提交与推送：日常集成线为 `dev`，稳定分支 `main` 通过 CI 和 PR 合入。
* 使用 `crapper`、`dryer`、`mutator` 前核实工具是否可用；不可用时在行动日志和完成报告中说明未执行的检查，不把其他检查视为这些工具的通过结果。
