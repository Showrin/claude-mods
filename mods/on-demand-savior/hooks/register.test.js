"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var testing_1 = require("claude-code/testing");
var register_1 = require("./register");
var NOW = Date.parse('2026-10-09T10:00:00Z');
var RESET = '2026-10-09T12:00:00Z';
var CWD = 'C:/proj';
var HANDOFF = "".concat(CWD, "/.claude/handoffs/handoff-2026-10-09T10-00-00.md");
var CONTEXT = { window: 200000 };
(0, testing_1.test)('helpers', function () {
    (0, testing_1.expect)((0, register_1.label)('five_hour')).toBe('5-hour');
    (0, testing_1.expect)((0, register_1.label)('seven_day')).toBe('weekly');
    (0, testing_1.expect)((0, register_1.threshold)(96)).toBe(96);
    (0, testing_1.expect)((0, register_1.threshold)('90')).toBe(90);
    (0, testing_1.expect)((0, register_1.threshold)(undefined)).toBe(96);
    (0, testing_1.expect)((0, register_1.threshold)(250)).toBe(96);
    (0, testing_1.expect)((0, register_1.stamp)(NOW)).toBe('2026-10-09T10-00-00');
    var week = { kind: 'seven_day', percentUsed: 97, resetsAt: '2026-10-12T00:00:00Z' };
    var hour = { kind: 'five_hour', percentUsed: 99, resetsAt: RESET };
    (0, testing_1.expect)((0, register_1.tripped)([hour], 96, NOW)).toEqual(hour);
    (0, testing_1.expect)((0, register_1.tripped)([__assign(__assign({}, hour), { percentUsed: 95.9 })], 96, NOW)).toBeUndefined();
    // Both tripped: wait out the one that resets last.
    (0, testing_1.expect)((0, register_1.tripped)([hour, week], 96, NOW)).toEqual(week);
    // A window whose reset already passed is a stale reading.
    (0, testing_1.expect)((0, register_1.tripped)([__assign(__assign({}, hour), { resetsAt: '2026-10-09T09:00:00Z' })], 96, NOW)).toBeUndefined();
    // The on-demand window itself is never the trigger.
    (0, testing_1.expect)((0, register_1.tripped)([{ kind: 'spend_limit', percentUsed: 100, resetsAt: RESET }], 96, NOW)).toBeUndefined();
    (0, testing_1.expect)((0, register_1.handoffPrompt)({ kind: 'five_hour', percent: 96, resetsAt: RESET, pausedAt: NOW })).toContain('5-hour usage limit is at 96%');
    (0, testing_1.expect)((0, register_1.resumePrompt)('h.md', '# Doc')).toContain('saved this handoff to h.md');
    (0, testing_1.expect)((0, register_1.resumePrompt)('h.md', '# Doc').endsWith('# Doc')).toBe(true);
    (0, testing_1.expect)((0, register_1.resumePrompt)(undefined, undefined)).toContain('where you left off');
    var tail = (0, register_1.transcriptHandoff)([{ role: 'user', text: 'fix the bug', toolUses: [] }]);
    (0, testing_1.expect)(tail).toContain('**user**: fix the bug');
});
// The engine hands paths on in the platform's own spelling.
var slashes = function (path) { return path.replace(/\\/g, '/'); };
// The engine beneath the mod: what it was asked to abort, write and submit.
var engine = function (on, store, percentUsed) {
    if (store === void 0) { store = {}; }
    if (percentUsed === void 0) { percentUsed = 97; }
    var seen = { aborted: [], files: {}, submitted: [], forks: 0 };
    var clock = testing_1.mock.clock(on, { now: NOW });
    testing_1.mock.store(on, store);
    on('ui.status', function () { return ({ value: undefined }); });
    on('ui.toast', function () { return ({ value: undefined }); });
    on('session.start', function (_$, e) { return ({ cwd: e.cwd }); });
    on('session.cwd', function () { return ({ value: CWD }); });
    on('session.usage', function () { return ({ value: { startedAt: 1, context: CONTEXT, rateLimits: [{ kind: 'five_hour', percentUsed: percentUsed, resetsAt: RESET }] } }); });
    on('session.measure', function (_$, e) { return ({ changed: e.changed }); });
    on('command.register', function () { return ({ value: undefined }); });
    on('turn.start', function (_$, e) { return ({ turnId: e.turnId }); });
    on('turn.complete', function (_$, e) { return ({ text: e.answer }); });
    on('turn.abort', function (_$, e) {
        seen.aborted.push(e.turnId);
        return { value: undefined };
    });
    on('model.fork', function () {
        seen.forks++;
        return { value: { isAnswered: true, text: '# Handoff\nGoal: ship it', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } };
    });
    on('fs.write', function (_$, e) {
        seen.files[slashes(e.path)] = e.text;
        return { value: undefined };
    });
    on('fs.read', function (_$, e) { return ({ value: seen.files[slashes(e.path)] }); });
    on('prompt.submit', function (_$, e) {
        seen.submitted.push(e.text);
        return { text: e.text };
    });
    on('tool.call', function () { return ({ result: 'ran' }); });
    return { seen: seen, clock: clock };
};
var measure = function (percentUsed) { return ({
    context: CONTEXT,
    rateLimits: [{ kind: 'five_hour', percentUsed: percentUsed, resetsAt: RESET }],
    changed: ['rateLimits'],
}); };
(0, testing_1.test)('pauses at the threshold, writes a handoff, blocks work, then resumes from it after the reset', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, seen, clock, dropped, denied, passed;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = engine(on), seen = _a.seen, clock = _a.clock;
                return [4 /*yield*/, $.session.start({ cwd: CWD })];
            case 1:
                _b.sent();
                return [4 /*yield*/, $.turn.start({ text: 'build it', turnId: 't1' })];
            case 2:
                _b.sent();
                return [4 /*yield*/, $.session.measure(measure(95))];
            case 3:
                _b.sent();
                return [4 /*yield*/, clock.settle()];
            case 4:
                _b.sent();
                (0, testing_1.expect)(seen.forks).toBe(0);
                return [4 /*yield*/, $.session.measure(measure(97))];
            case 5:
                _b.sent();
                return [4 /*yield*/, clock.settle()];
            case 6:
                _b.sent();
                (0, testing_1.expect)(seen.aborted).toEqual(['t1']);
                (0, testing_1.expect)(seen.files[HANDOFF]).toBe('# Handoff\nGoal: ship it');
                return [4 /*yield*/, $.prompt.submit({ text: 'keep going' })];
            case 7:
                dropped = _b.sent();
                (0, testing_1.expect)(dropped.drop).toContain('Paused at 5-hour 97%');
                (0, testing_1.expect)(seen.submitted).toEqual([]);
                return [4 /*yield*/, $.tool.call({ tool: 'Bash', input: { command: 'ls' } })];
            case 8:
                denied = _b.sent();
                (0, testing_1.expect)(denied.deny).toContain('paused this session');
                // A second reading in the same window does not pause twice.
                return [4 /*yield*/, $.session.measure(measure(98))];
            case 9:
                // A second reading in the same window does not pause twice.
                _b.sent();
                return [4 /*yield*/, clock.settle()];
            case 10:
                _b.sent();
                (0, testing_1.expect)(seen.forks).toBe(1);
                return [4 /*yield*/, clock.set(Date.parse(RESET) + 90000)];
            case 11:
                _b.sent();
                (0, testing_1.expect)(seen.submitted).toHaveLength(1);
                (0, testing_1.expect)(seen.submitted[0]).toContain("saved this handoff to ".concat(HANDOFF));
                (0, testing_1.expect)(seen.submitted[0]).toContain('Goal: ship it');
                return [4 /*yield*/, $.prompt.submit({ text: 'thanks' })];
            case 12:
                passed = _b.sent();
                (0, testing_1.expect)(passed.drop).toBeUndefined();
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('/savior off stops guarding and clears the pause; /savior on guards again at once', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, seen, clock, _b, off, _c, _d;
    return __generator(this, function (_e) {
        switch (_e.label) {
            case 0:
                _a = engine(on), seen = _a.seen, clock = _a.clock;
                return [4 /*yield*/, $.session.start({ cwd: CWD })];
            case 1:
                _e.sent();
                return [4 /*yield*/, $.session.measure(measure(97))];
            case 2:
                _e.sent();
                return [4 /*yield*/, clock.settle()];
            case 3:
                _e.sent();
                _b = testing_1.expect;
                return [4 /*yield*/, $.prompt.submit({ text: 'hi' })];
            case 4:
                _b.apply(void 0, [(_e.sent()).drop]).toBeDefined();
                return [4 /*yield*/, $.command.run({ command: 'savior', args: 'off' })];
            case 5:
                off = _e.sent();
                (0, testing_1.expect)(off.text).toContain('is off');
                _c = testing_1.expect;
                return [4 /*yield*/, $.prompt.submit({ text: 'hi' })];
            case 6:
                _c.apply(void 0, [(_e.sent()).drop]).toBeUndefined();
                // Off: readings past the threshold are ignored.
                return [4 /*yield*/, $.session.measure(measure(99))];
            case 7:
                // Off: readings past the threshold are ignored.
                _e.sent();
                return [4 /*yield*/, clock.settle()];
            case 8:
                _e.sent();
                (0, testing_1.expect)(seen.forks).toBe(1);
                // On again: the last reading is already past it, so it pauses right away.
                return [4 /*yield*/, $.command.run({ command: 'savior', args: 'on' })];
            case 9:
                // On again: the last reading is already past it, so it pauses right away.
                _e.sent();
                return [4 /*yield*/, clock.settle()];
            case 10:
                _e.sent();
                (0, testing_1.expect)(seen.forks).toBe(2);
                _d = testing_1.expect;
                return [4 /*yield*/, $.command.run({ command: 'savior', args: '' })];
            case 11:
                _d.apply(void 0, [(_e.sent()).text]).toContain('Paused at 5-hour 97%');
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('/savior resume goes on before the reset', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, seen, clock, resumed, _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                _a = engine(on), seen = _a.seen, clock = _a.clock;
                return [4 /*yield*/, $.session.start({ cwd: CWD })];
            case 1:
                _c.sent();
                return [4 /*yield*/, $.session.measure(measure(97))];
            case 2:
                _c.sent();
                return [4 /*yield*/, clock.settle()];
            case 3:
                _c.sent();
                return [4 /*yield*/, $.command.run({ command: 'savior', args: 'resume' })];
            case 4:
                resumed = _c.sent();
                (0, testing_1.expect)(resumed.text).toContain('resumed');
                return [4 /*yield*/, clock.settle()];
            case 5:
                _c.sent();
                (0, testing_1.expect)(seen.submitted[0]).toContain('Goal: ship it');
                _b = testing_1.expect;
                return [4 /*yield*/, $.command.run({ command: 'savior', args: 'resume' })];
            case 6:
                _b.apply(void 0, [(_c.sent()).text]).toContain('nothing is paused');
                return [2 /*return*/];
        }
    });
}); });
(0, testing_1.test)('a pause left by an earlier session resumes once its window resets', function ($, on) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, seen, clock, _b;
    var _c;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0:
                _a = engine(on, (_c = {},
                    _c["pause:".concat(CWD)] = { kind: 'five_hour', percent: 97, resetsAt: RESET, pausedAt: NOW, handoffPath: "".concat(CWD, "/old.md") },
                    _c)), seen = _a.seen, clock = _a.clock;
                seen.files["".concat(CWD, "/old.md")] = '# Old handoff';
                return [4 /*yield*/, $.session.start({ cwd: CWD })];
            case 1:
                _d.sent();
                _b = testing_1.expect;
                return [4 /*yield*/, $.prompt.submit({ text: 'hi' })];
            case 2:
                _b.apply(void 0, [(_d.sent()).drop]).toBeDefined();
                return [4 /*yield*/, clock.set(Date.parse(RESET) + 90000)];
            case 3:
                _d.sent();
                (0, testing_1.expect)(seen.submitted[0]).toContain('# Old handoff');
                return [2 /*return*/];
        }
    });
}); });
