/*
 * Copyright 2015 Amadeus s.a.s.
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

var util = require("util");
var url = require("url");
var events = require("events");
var Q = require("q");
var request = require("../util/request");

var VBoxRobotLauncher = module.exports = function() {};

var crypto = require("crypto");
var idNumber = 0;
var createId = function() {
    idNumber++;
    return idNumber + new Buffer(crypto.pseudoRandomBytes(8)).toString("hex");
};

util.inherits(VBoxRobotLauncher, events.EventEmitter);

var wait = function(delay) {
    return new Q.Promise(function(resolve) {
        setTimeout(resolve, delay);
    });
};

VBoxRobotLauncher.prototype.start = function(param) {
    var self = this;
    var config = param.config;
    var configError = "";
    if (!config.server || !config.vm || !config.snapshot || !config.username || !config.command) {
        configError += "At least one of the following mandatory properties is missing: server, vm, snapshot, username, command.";
    }
    if (configError) {
        self.emit("log", ["error", configError]);
        self.emit("disable");
        self.emit("exit");
        return;
    }

    var errorHandler = this.onError.bind(this);
    self.stopPromise = Q.Promise(function(resolve) {
        self.stopped = false;
        self.stopResolve = function() {
            self.stopped = true;
            resolve();
        };
    });
    var actionUrls = null;

    var variables = {};
    var replaceVariables = function(item) {
        return item.replace(/\$\{([a-zA-Z0-9-]+)\}/g, function(wholeString, variableName) {
            if (variables.hasOwnProperty(variableName)) {
                return variables[variableName];
            }
            return wholeString;
        });
    };

    var run = function(commandLine) {
        commandLine = commandLine.map(replaceVariables);
        return request({
            url: actionUrls.run,
            method: "POST",
            json: true,
            body: {
                user: config.username,
                password: config.password,
                commandLine: commandLine
            }
        }).then(function(response) {
            self.onRunResponse(commandLine[0], response);
            return response;
        });
    };

    var pingCommandLine = config.pingCommand ? [].concat(config.pingCommand, "${ATTESTER-HOSTNAME}") : null;
    var waitForConnectivity = function() {
        if (!self.stopped && pingCommandLine) {
            return run(pingCommandLine).then(function(response) {
                if (response.exitCode !== 0) {
                    return wait(config.pingInterval || 1000).then(waitForConnectivity);
                }
            });
        }
    };

    var initCommands = config.initCommands ? [].concat(config.initCommands) : [];
    var runInitCommands = function() {
        if (!self.stopped && initCommands.length > 0) {
            var entry = initCommands.shift();
            return run(entry.command).then(runInitCommands);
        }
    };

    request({
            url: config.server,
            method: "POST",
            json: true,
            body: {
                clone: config.vm,
                snapshot: config.snapshot,
                closeOnFailedCalibration: config.closeOnFailedCalibration != null ? config.closeOnFailedCalibration : true
            }
        })
        .then(function(response) {
            actionUrls = response;
            variables["ATTESTER-VMUNIQUEID"] = createId();
            variables["ATTESTER-HOSTNAME"] = url.parse(param.url).hostname;
            // the full URL has to pass through replaceVariables to allow variables to be specified in urlExtraParameters:
            variables["ATTESTER-URL"] = replaceVariables(param.url + "&plugin=" + encodeURIComponent(actionUrls.robotjs));
            return waitForConnectivity();
        })
        .then(runInitCommands)
        .then(function() {
            if (!self.stopped) {
                run([].concat(config.command, config.commandArgs || [], "${ATTESTER-URL}"))
                    .catch(errorHandler)
                    .then(function() {
                        if (!config.launcherOnly) {
                            var stopResolve = self.stopResolve;
                            stopResolve();
                        }
                    });
            }
            return self.stopPromise;
        })
        .catch(errorHandler)
        .then(function() {
            if (actionUrls) {
                return request({
                    url: actionUrls.close,
                    method: "POST"
                });
            }
        })
        .catch(errorHandler)
        .then(function() {
            self.emit("exit");
        });
};

VBoxRobotLauncher.prototype.onError = function(error) {
    this.emit("log", ["error", "[error] %s", error + ""]);
    if (error.code == "ECONNREFUSED" || error.status === 401) {
        this.emit("disable");
    }
};

VBoxRobotLauncher.prototype.onProcessLog = function(command, outputType, line) {
    this.emit("log", ["info", "[%s] [%s] %s", command, outputType, line]);
};

VBoxRobotLauncher.prototype.onRunResponse = function(command, response) {
    var stdout = response.stdout.trim();
    var stderr = response.stderr.trim();
    if (stdout) {
        stdout.split(/\r?\n/).forEach(this.onProcessLog.bind(this, command, "stdout"));
    }
    if (stderr) {
        stderr.split(/\r?\n/).forEach(this.onProcessLog.bind(this, command, "stderr"));
    }
};

VBoxRobotLauncher.prototype.stop = function() {
    if (this.stopResolve) {
        this.stopResolve();
    }
};
