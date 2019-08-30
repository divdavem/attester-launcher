/*
 * Copyright 2019 Amadeus s.a.s.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var webdriver = require('selenium-webdriver');
var Key = webdriver.Key;
var exposedKeys = {
    Backspace: {
        code: Key.BACK_SPACE
    }
};
Object.keys(Key).forEach(function(key) {
    exposedKeys[key] = {
        code: Key[key]
    };
});

// Note: the following function is stringified by webdriver to be run in the browser
var script = function(exposedKeys) {
    /* globals window: false */
    var robot = window.phantomJSRobot;
    if (!robot) {
        var callback = null;
        var immediateTimeout = null;
        var longTimeout = null;
        var queue = [];
        var clearTimeouts = function() {
            if (longTimeout) {
                clearTimeout(longTimeout);
                longTimeout = null;
            }
            if (immediateTimeout) {
                clearTimeout(immediateTimeout);
                immediateTimeout = null;
            }
        };
        var callCallback = function() {
            clearTimeouts();
            var curCallback = callback;
            var curQueue = queue;
            if (curCallback) {
                callback = null;
                queue = [];
                curCallback(curQueue);
            }
        };
        var planCallback = function() {
            if (!immediateTimeout && callback && queue.length > 0) {
                immediateTimeout = setTimeout(callCallback, 0);
            }
        };
        var setCallback = function(value) {
            callback = value;
            planCallback();
            longTimeout = setTimeout(callCallback, 1000);
        };
        robot = window.phantomJSRobot = {
            __setCallback: setCallback,
            keys: exposedKeys,
            sendEvent: function() {
                queue.push(arguments);
                planCallback();
            }
        };
        window.addEventListener("unload", callCallback);
    }
    robot.__setCallback(arguments[arguments.length - 1]);
};

var BUTTONS = {
    "left": webdriver.Button.LEFT,
    "right": webdriver.Button.RIGHT,
    "middle": webdriver.Button.MIDDLE
};

module.exports = function(driver, stopPromise, logError) {
    var stopped = false;
    stopPromise.then(function() {
        stopped = true;
    });

    var currentActions = null;
    var tasksHandlers = {
        mousemove: function(x, y) {
            currentActions.move({
                origin: webdriver.Origin.VIEWPORT,
                x: x,
                y: y,
                duration: 0
            });
        },
        mousedown: function(x, y, button) {
            currentActions.press(BUTTONS[button]);
        },
        mouseup: function(x, y, button) {
            currentActions.release(BUTTONS[button]);
        },
        keydown: function(key) {
            key = key.code || key;
            currentActions.keyDown(key);
        },
        keyup: function(key) {
            key = key.code || key;
            currentActions.keyUp(key);
        }
    };

    var executeTask = function(task) {
        var handler = tasksHandlers[task[0]];
        if (handler) {
            task.shift();
            handler.apply(null, task);
        }
    };

    var waitForTasks = function() {
        if (stopped) {
            return;
        }
        return driver.executeAsyncScript(script, exposedKeys).then(function(tasks) {
            if (stopped) {
                return;
            }
            currentActions = driver.actions();
            tasks.forEach(executeTask);
            return currentActions.perform().catch(logError).then(waitForTasks);
        });
    };

    return waitForTasks();
};
