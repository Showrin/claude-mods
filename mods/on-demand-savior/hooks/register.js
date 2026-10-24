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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = exports.resumePrompt = exports.transcriptHandoff = exports.handoffPrompt = exports.stamp = exports.clockTime = exports.resumesAt = exports.tripped = exports.threshold = exports.label = void 0;
var COMMAND = 'savior';
var WATCHED = ['five_hour', 'seven_day'];
var LABELS = { five_hour: '5-hour', seven_day: 'weekly' };
var DEFAULT_THRESHOLD = 96;
// Resume a minute after the reset, so the first request lands in the new window.
var GRACE_MS = 60000;
var POLL_MS = 30000;
var DAY = 24 * 60 * 60 * 1000;
var label = function (kind) { var _a; return (_a = LABELS[kind]) !== null && _a !== void 0 ? _a : kind.replace(/_/g, ' '); };
exports.label = label;
var threshold = function (setting) {
    var n = Number(setting);
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_THRESHOLD;
};
exports.threshold = threshold;
// The watched window at or past the threshold that resets last (the one to
// wait out); a window whose reset has passed is stale and never trips.
var tripped = function (limits, at, now) {
    return limits
        .filter(function (l) { return WATCHED.includes(l.kind) && l.percentUsed >= at && l.resetsAt && Date.parse(l.resetsAt) > now; })
        .sort(function (a, b) { return Date.parse(b.resetsAt) - Date.parse(a.resetsAt); })[0];
};
exports.tripped = tripped;
var resumesAt = function (pause) { return Date.parse(pause.resetsAt) + GRACE_MS; };
exports.resumesAt = resumesAt;
// "3:31 PM", or "Sat 3:31 PM" when more than a day out.
var clockTime = function (at, now) {
    return new Intl.DateTimeFormat('en-US', {
        weekday: at - now > DAY ? 'short' : undefined,
        hour: 'numeric',
        minute: '2-digit',
    }).format(at);
};
exports.clockTime = clockTime;
// 2026-10-09T14:30:05.000Z -> "2026-10-09T14-30-05"
var stamp = function (now) { return new Date(now).toISOString().slice(0, 19).replace(/:/g, '-'); };
exports.stamp = stamp;
var handoffPrompt = function (pause) {
    return [
        "You are being paused: the ".concat((0, exports.label)(pause.kind), " usage limit is at ").concat(pause.percent, "%, and going on would spill into on-demand usage."),
        'Write a handoff document that lets you pick this work up after the limit resets, with no other memory of this conversation.',
        'Use Markdown with these sections: Goal; Done so far; In progress (exactly where you stopped, including any half-finished edit);',
        'Next steps (in order); Key files and facts (paths, commands, decisions, gotchas); Open questions for the user.',
        'Be specific and concise. Reply with the document only.',
    ].join(' ');
};
exports.handoffPrompt = handoffPrompt;
// Used when the model could not write the handoff: the conversation's tail, as it stands.
var transcriptHandoff = function (messages) {
    return __spreadArray([
        '# Handoff (transcript excerpt)',
        'The model could not write a summary, so this is the end of the conversation as it stood.'
    ], messages.slice(-20).map(function (m) {
        var tools = m.toolUses.length ? "\n_tools: ".concat(m.toolUses.map(function (u) { return u.tool; }).join(', '), "_") : '';
        return "**".concat(m.role, "**: ").concat(m.text.slice(0, 2000)).concat(tools);
    }), true).join('\n\n');
};
exports.transcriptHandoff = transcriptHandoff;
var resumePrompt = function (path, doc) {
    return doc
        ? "The usage limit has reset. on-demand-savior paused you before it ran into on-demand usage and saved this handoff to ".concat(path, ". Pick the work up from it:\n\n").concat(doc)
        : 'The usage limit has reset. on-demand-savior paused you before it ran into on-demand usage. Pick the work up where you left off.';
};
exports.resumePrompt = resumePrompt;
var pausedLine = function (pause, now) {
    return "\uD83D\uDEDF Paused at ".concat((0, exports.label)(pause.kind), " ").concat(pause.percent, "% \u00B7 resumes ").concat((0, exports.clockTime)((0, exports.resumesAt)(pause), now));
};
// Module variables: a reload starts them over, the store keeps the pause itself.
var at = DEFAULT_THRESHOLD;
var turnId;
var poll;
var isPausing = false;
// One pause per project, so a session elsewhere neither resumes nor clears it.
function key($) {
    return __awaiter(this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = "pause:".concat;
                    return [4 /*yield*/, $.session.cwd()];
                case 1: return [2 /*return*/, _a.apply("pause:", [_b.sent()])];
            }
        });
    });
}
function isEnabled($) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, $.store.get('enabled')];
                case 1: return [2 /*return*/, (_a.sent()) !== false];
            }
        });
    });
}
function getPause($) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _b = (_a = $.store).get;
                    return [4 /*yield*/, key($)];
                case 1: return [4 /*yield*/, _b.apply(_a, [_c.sent()])];
                case 2: return [2 /*return*/, (_c.sent())];
            }
        });
    });
}
// The pause in force: enabled, and its window not yet reset.
function active($) {
    return __awaiter(this, void 0, void 0, function () {
        var pause, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, getPause($)];
                case 1:
                    pause = _b.sent();
                    _a = !pause;
                    if (_a) return [3 /*break*/, 3];
                    return [4 /*yield*/, isEnabled($)];
                case 2:
                    _a = !(_b.sent());
                    _b.label = 3;
                case 3:
                    if (_a) {
                        return [2 /*return*/, undefined];
                    }
                    return [4 /*yield*/, $.clock.now()];
                case 4: return [2 /*return*/, (_b.sent()) < (0, exports.resumesAt)(pause) ? pause : undefined];
            }
        });
    });
}
function stopPoll() {
    poll === null || poll === void 0 ? void 0 : poll.cancel();
    poll = undefined;
}
function resume($) {
    return __awaiter(this, void 0, void 0, function () {
        var pause, _a, _b, doc, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, getPause($)];
                case 1:
                    pause = _d.sent();
                    stopPoll();
                    $.ui.status(undefined);
                    if (!pause) {
                        return [2 /*return*/];
                    }
                    _b = (_a = $.store).delete;
                    return [4 /*yield*/, key($)];
                case 2: return [4 /*yield*/, _b.apply(_a, [_d.sent()])];
                case 3:
                    _d.sent();
                    if (!pause.handoffPath) return [3 /*break*/, 5];
                    return [4 /*yield*/, $.fs.read(pause.handoffPath).catch(function () { return undefined; })];
                case 4:
                    _c = _d.sent();
                    return [3 /*break*/, 6];
                case 5:
                    _c = undefined;
                    _d.label = 6;
                case 6:
                    doc = _c;
                    $.ui.toast('🛟 Limit reset: resuming from the handoff');
                    // Off this dispatch: a command.run hook may not wait on a turn of its own.
                    $.clock.after(0, function () { return void $.prompt.submit({ text: (0, exports.resumePrompt)(pause.handoffPath, doc) }); });
                    return [2 /*return*/];
            }
        });
    });
}
function arm($) {
    var _this = this;
    if (poll) {
        return;
    }
    poll = $.clock.every(POLL_MS, function () { return __awaiter(_this, void 0, void 0, function () {
        var pause, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, getPause($)];
                case 1:
                    pause = _b.sent();
                    _a = !pause;
                    if (_a) return [3 /*break*/, 3];
                    return [4 /*yield*/, isEnabled($)];
                case 2:
                    _a = !(_b.sent());
                    _b.label = 3;
                case 3:
                    if (!_a) return [3 /*break*/, 4];
                    stopPoll();
                    return [3 /*break*/, 7];
                case 4: return [4 /*yield*/, $.clock.now()];
                case 5:
                    if (!((_b.sent()) >= (0, exports.resumesAt)(pause))) return [3 /*break*/, 7];
                    return [4 /*yield*/, resume($)];
                case 6:
                    _b.sent();
                    _b.label = 7;
                case 7: return [2 /*return*/];
            }
        });
    }); });
}
function pauseSession($, limit) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, now, paused, _b, _c, reply, doc, _d, _e, handoffPath, _f, _g, _h;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    _a = isPausing;
                    if (_a) return [3 /*break*/, 2];
                    return [4 /*yield*/, getPause($)];
                case 1:
                    _a = (_j.sent());
                    _j.label = 2;
                case 2:
                    if (_a) {
                        return [2 /*return*/];
                    }
                    isPausing = true;
                    _j.label = 3;
                case 3:
                    _j.trys.push([3, , 18, 19]);
                    return [4 /*yield*/, $.clock.now()];
                case 4:
                    now = _j.sent();
                    paused = { kind: limit.kind, percent: limit.percentUsed, resetsAt: limit.resetsAt, pausedAt: now };
                    _c = (_b = $.store).set;
                    return [4 /*yield*/, key($)];
                case 5: return [4 /*yield*/, _c.apply(_b, [_j.sent(), paused])];
                case 6:
                    _j.sent();
                    $.ui.status(pausedLine(paused, now));
                    if (!turnId) return [3 /*break*/, 8];
                    return [4 /*yield*/, $.turn.abort({ turnId: turnId }).catch(function () { return undefined; })];
                case 7:
                    _j.sent();
                    _j.label = 8;
                case 8: return [4 /*yield*/, $.model.fork({ prompt: (0, exports.handoffPrompt)(paused) })];
                case 9:
                    reply = _j.sent();
                    if (!reply.isAnswered) return [3 /*break*/, 10];
                    _d = reply.text;
                    return [3 /*break*/, 12];
                case 10:
                    _e = exports.transcriptHandoff;
                    return [4 /*yield*/, $.session.messages().catch(function () { return []; })];
                case 11:
                    _d = _e.apply(void 0, [_j.sent()]);
                    _j.label = 12;
                case 12:
                    doc = _d;
                    _f = "".concat;
                    return [4 /*yield*/, $.session.cwd()];
                case 13:
                    handoffPath = _f.apply("", [_j.sent(), "/.claude/handoffs/handoff-"]).concat((0, exports.stamp)(now), ".md");
                    return [4 /*yield*/, $.fs.write(handoffPath, doc)
                        // `/savior off` or `resume` while the handoff was being written wins.
                    ];
                case 14:
                    _j.sent();
                    return [4 /*yield*/, getPause($)];
                case 15:
                    // `/savior off` or `resume` while the handoff was being written wins.
                    if (!(_j.sent())) {
                        return [2 /*return*/];
                    }
                    _h = (_g = $.store).set;
                    return [4 /*yield*/, key($)];
                case 16: return [4 /*yield*/, _h.apply(_g, [_j.sent(), __assign(__assign({}, paused), { handoffPath: handoffPath })])];
                case 17:
                    _j.sent();
                    $.ui.toast("\uD83D\uDEDF ".concat((0, exports.label)(paused.kind), " limit at ").concat(paused.percent, "%: paused, handoff saved to ").concat(handoffPath));
                    arm($);
                    return [3 /*break*/, 19];
                case 18:
                    isPausing = false;
                    return [7 /*endfinally*/];
                case 19: return [2 /*return*/];
            }
        });
    });
}
function check($, limits) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, _b, hit, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    _b = isPausing;
                    if (_b) return [3 /*break*/, 2];
                    return [4 /*yield*/, isEnabled($)];
                case 1:
                    _b = !(_e.sent());
                    _e.label = 2;
                case 2:
                    _a = _b;
                    if (_a) return [3 /*break*/, 4];
                    return [4 /*yield*/, getPause($)];
                case 3:
                    _a = (_e.sent());
                    _e.label = 4;
                case 4:
                    if (_a) {
                        return [2 /*return*/];
                    }
                    _c = exports.tripped;
                    _d = [limits, at];
                    return [4 /*yield*/, $.clock.now()];
                case 5:
                    hit = _c.apply(void 0, _d.concat([_e.sent()]));
                    if (hit) {
                        // Off this dispatch: the pause aborts the turn and waits on the model.
                        $.clock.after(0, function () { return void pauseSession($, hit); });
                    }
                    return [2 /*return*/];
            }
        });
    });
}
function status($) {
    return __awaiter(this, void 0, void 0, function () {
        var pause, handoff, _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, isEnabled($)];
                case 1:
                    if (!(_d.sent())) {
                        return [2 /*return*/, 'on-demand-savior is off: at the limit, Claude goes on into on-demand usage. /savior on to guard again.'];
                    }
                    return [4 /*yield*/, active($)];
                case 2:
                    pause = _d.sent();
                    if (!pause) return [3 /*break*/, 4];
                    handoff = pause.handoffPath ? " Handoff: ".concat(pause.handoffPath, ".") : '';
                    _a = "".concat;
                    _b = pausedLine;
                    _c = [pause];
                    return [4 /*yield*/, $.clock.now()];
                case 3: return [2 /*return*/, _a.apply("", [_b.apply(void 0, _c.concat([_d.sent()])), "."]).concat(handoff, " /savior resume to go on now (may use on-demand usage).")];
                case 4: return [2 /*return*/, "on-demand-savior is on: pauses at ".concat(at, "% of the 5-hour or weekly limit.")];
            }
        });
    });
}
var register = function (on, options) {
    at = (0, exports.threshold)(options.threshold);
    on('session.start', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var result, paused, _a, _b, _c, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0: return [4 /*yield*/, next(e)];
                case 1:
                    result = _f.sent();
                    return [4 /*yield*/, $.command.register({
                            name: COMMAND,
                            description: 'Guard against on-demand usage: on, off, status, or resume now',
                            argumentHint: '[on|off|status|resume]',
                            immediate: true,
                        })
                        // A pause from an earlier session in this project: wait it out, or resume
                        // from its handoff right away if the window already reset.
                    ];
                case 2:
                    _f.sent();
                    return [4 /*yield*/, getPause($)];
                case 3:
                    paused = _f.sent();
                    _a = paused;
                    if (!_a) return [3 /*break*/, 5];
                    return [4 /*yield*/, isEnabled($)];
                case 4:
                    _a = (_f.sent());
                    _f.label = 5;
                case 5:
                    if (!_a) return [3 /*break*/, 7];
                    _c = (_b = $.ui).status;
                    _d = pausedLine;
                    _e = [paused];
                    return [4 /*yield*/, $.clock.now()];
                case 6:
                    _c.apply(_b, [_d.apply(void 0, _e.concat([_f.sent()]))]);
                    arm($);
                    _f.label = 7;
                case 7: return [2 /*return*/, result];
            }
        });
    }); });
    on('command.run', { command: COMMAND }, function ($, e) { return __awaiter(void 0, void 0, void 0, function () {
        var action, _a, _b, _c, _d;
        var _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    action = e.args.trim().toLowerCase();
                    if (!(action === 'off')) return [3 /*break*/, 4];
                    return [4 /*yield*/, $.store.set('enabled', false)];
                case 1:
                    _f.sent();
                    _b = (_a = $.store).delete;
                    return [4 /*yield*/, key($)];
                case 2: return [4 /*yield*/, _b.apply(_a, [_f.sent()])];
                case 3:
                    _f.sent();
                    stopPoll();
                    $.ui.status(undefined);
                    return [3 /*break*/, 12];
                case 4:
                    if (!(action === 'on')) return [3 /*break*/, 8];
                    return [4 /*yield*/, $.store.set('enabled', true)
                        // The last reading may already be past the threshold; no new point may come.
                    ];
                case 5:
                    _f.sent();
                    _c = check;
                    _d = [$];
                    return [4 /*yield*/, $.session.usage()];
                case 6: 
                // The last reading may already be past the threshold; no new point may come.
                return [4 /*yield*/, _c.apply(void 0, _d.concat([(_f.sent()).rateLimits]))];
                case 7:
                    // The last reading may already be past the threshold; no new point may come.
                    _f.sent();
                    return [3 /*break*/, 12];
                case 8:
                    if (!(action === 'resume')) return [3 /*break*/, 11];
                    return [4 /*yield*/, getPause($)];
                case 9:
                    if (!(_f.sent())) {
                        return [2 /*return*/, { text: 'on-demand-savior: nothing is paused.' }];
                    }
                    return [4 /*yield*/, resume($)];
                case 10:
                    _f.sent();
                    return [2 /*return*/, { text: 'on-demand-savior: resumed from the handoff before the reset; this may use on-demand usage.' }];
                case 11:
                    if (action !== '' && action !== 'status') {
                        return [2 /*return*/, { text: "on-demand-savior: unknown \"".concat(action, "\". Use /savior on, off, status or resume.") }];
                    }
                    _f.label = 12;
                case 12:
                    _e = {};
                    return [4 /*yield*/, status($)];
                case 13: return [2 /*return*/, (_e.text = _f.sent(), _e)];
            }
        });
    }); });
    on('session.measure', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!e.changed.includes('rateLimits')) return [3 /*break*/, 2];
                    return [4 /*yield*/, check($, e.rateLimits)];
                case 1:
                    _a.sent();
                    _a.label = 2;
                case 2: return [2 /*return*/, next(e)];
            }
        });
    }); });
    on('turn.start', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    turnId = e.turnId;
                    return [4 /*yield*/, next(e)
                        // A turn that starts while paused (a continuation, a skill) ends at once.
                    ];
                case 1:
                    result = _a.sent();
                    return [4 /*yield*/, active($)];
                case 2:
                    // A turn that starts while paused (a continuation, a skill) ends at once.
                    if (_a.sent()) {
                        void $.turn.abort({ turnId: e.turnId }).catch(function () { return undefined; });
                    }
                    return [2 /*return*/, result];
            }
        });
    }); });
    on('turn.complete', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            if (!e.agentId && e.turnId === turnId) {
                turnId = undefined;
            }
            return [2 /*return*/, next(e)];
        });
    }); });
    // Slash commands pass, so /savior itself still answers while paused.
    on('prompt.submit', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        var pause, _a, _b, _c, _d;
        var _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    if (!e.text.trimStart().startsWith('/')) return [3 /*break*/, 1];
                    _a = undefined;
                    return [3 /*break*/, 3];
                case 1: return [4 /*yield*/, active($)];
                case 2:
                    _a = _f.sent();
                    _f.label = 3;
                case 3:
                    pause = _a;
                    if (!pause) return [3 /*break*/, 5];
                    _e = {};
                    _b = "".concat;
                    _c = pausedLine;
                    _d = [pause];
                    return [4 /*yield*/, $.clock.now()];
                case 4: return [2 /*return*/, (_e.drop = _b.apply("", [_c.apply(void 0, _d.concat([_f.sent()])), ". /savior resume to go on now (may use on-demand usage), /savior off to stop guarding."]), _e)];
                case 5: return [2 /*return*/, next(e)];
            }
        });
    }); });
    on('tool.call', function ($, e, next) { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, active($)];
                case 1:
                    if (_a.sent()) {
                        return [2 /*return*/, { deny: 'on-demand-savior paused this session at the usage limit; stop here, the work resumes when the limit resets.' }];
                    }
                    return [2 /*return*/, next(e)];
            }
        });
    }); });
};
exports.register = register;
