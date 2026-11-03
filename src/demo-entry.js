// One browser bundle gives the local demo the same dependency graph as the
// installed app, including durable analytics and resilience libraries.
export {boot} from './app.js';
export {DEFAULTS,copy} from './core/engine.js';
