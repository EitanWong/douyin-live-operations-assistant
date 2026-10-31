import { ToolRegistry } from './registry.js';
import { autoLikeTool } from './auto-like/index.js';
import { rewardsTool } from './rewards/index.js';
import { autoGiftTool } from './auto-gift/index.js';

export const bundledTools = new ToolRegistry([autoLikeTool, rewardsTool, autoGiftTool]);
