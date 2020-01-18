const window = global; const _ = require('underscore'); const riot = {observable: require('@riotjs/observable')};
(function(unobservable) { "use strict";

// Black magic stuff
function CustomArray(numPreallocated) {
    this.arr = new Array(numPreallocated);
    this.len = 0;
}
CustomArray.prototype.push = function(e) {
    this.arr[this.len++] = e;
};
CustomArray.prototype.removeAt = function(index) {
    for(var j=index+1; j<this.len; j++) {
        this.arr[j-1] = this.arr[j];
    }
    // Potential memory leak right here, last element does not get nulled out as it should? Or?
    this.len--;
}

unobservable.observable = function(obj, options) {
    options = options || {};
    options.numPreallocatedHandlers = options.numPreallocatedHandlers || 0;
    options.addDataMembers = (typeof options.addDataMembers !== "undefined") ? options.addDataMembers : true;
    if(options.addDataMembers) {
        obj.callbacks = {};
    }

    obj.on = function(events, fn) {
        // This function is convoluted because we would like to avoid using split or regex, both which cause an array allocation
        var count = 0;
        for(var i=0, len=events.length; i<len; ++i) {
            var name = "";
            var i2 = events.indexOf(" ", i);
            if(i2 < 0) {
                if(i < events.length) {
                    name = events.slice(i);
                    count++;
                }
                i = len;
            }
            else if(i2-i > 1) {
                var name = events.slice(i, i2);
                count++;
                i = i2;
            }
            if(name.length > 0) {
                (this.callbacks[name] = this.callbacks[name] || new CustomArray()).push(fn);
            }
        }
        fn.typed = count > 1;
    };

    obj.off = function(events, fn) {
        if (events === "*") this.callbacks = {};
        else if (fn) {
            var fns = this.callbacks[events];
            for (var i = 0, len=fns.len; i<len; ++i) {
                var cb = fns.arr[i];
                if(cb === fn) { fns.removeAt(i); }
            }
        } else {
            var count = 0;
            for(var i=0, len=events.length; i<len; ++i) {
                var name = "";
                var i2 = events.indexOf(" ", i);
                if(i2 < 0) {
                    if(i < events.length) {
                        name = events.slice(i);
                    }
                    i = len;
                }
                else if(i2-i > 1) {
                    var name = events.slice(i, i2);
                    i = i2;
                }
                if(name.length > 0) {
                    this.callbacks[name] = undefined;
                }
            }
        }
        return this;
    };

    // Only single event supported
    obj.one = function(name, fn) {
        fn.one = true;
        return this.on(name, fn);
    };

    obj.trigger = function(name, arg1, arg2, arg3, arg4) {
        // Just using bogus args is much faster than manipulating the arguments array
        var fns = this.callbacks[name];
        if(!fns) { return this; }

        for (var i=0; i<fns.len; i++) { // Note: len can change during iteration
            var fn = fns.arr[i];
            if(fn.typed) { fn.call(this, name, arg1, arg2, arg3, arg4); }
            else { fn.call(this, arg1, arg2, arg3, arg4); }
            if (fn.one) { fns.removeAt(i, 1); fn.one = false; i--; }
            else if(fns.arr[i] && fns.arr[i] !== fn) { i-- } // Makes self-removal possible during iteration
        }
        return this;
    };
    return obj;
};

unobservable.Observable = function() {
    this.callbacks = {};
};
unobservable.observable(unobservable.Observable.prototype, {numPreallocatedHandlers: 2, addDataMembers: false});
unobservable.asObservable = unobservable.observable;
unobservable.CustomArray = CustomArray; // Expose for testability
})((typeof window !== "undefined" ? window.unobservable = {} : (typeof exports !== "undefined" ? exports : self.unobservable = {})));
var EPSILON = 0.00001;

var linearInterpolate = function(value0, value1, x) {
    return value0 + (value1 - value0) * x;
};
var powInterpolate = function(value0, value1, x, a) {
    return value0 + (value1 - value0) * Math.pow(x, a) / (Math.pow(x, a) + Math.pow(1-x, a));
};
var coolInterpolate = function(value0, value1, x) {
    return powInterpolate(value0, value1, x, 1.3);
};
var DEFAULT_INTERPOLATOR = coolInterpolate;

var _tmpPosStorage = [0,0];

function Movable() {
    newGuard(this, Movable);
    unobservable.Observable.call(this);
    var movable = this;
    movable.x = 0.0;
    movable.y = 0.0;
    movable.parent = null;
    movable.worldX = 0.0;
    movable.worldY = 0.0;
    movable.currentTask = null;

    movable.trigger('new_state', movable);
}
Movable.prototype = Object.create(unobservable.Observable.prototype);

Movable.prototype.updateDisplayPosition = function(forceTrigger) {
    this.getWorldPosition(_tmpPosStorage);
    var oldX = this.worldX;
    var oldY = this.worldY;
    this.worldX = _tmpPosStorage[0];
    this.worldY = _tmpPosStorage[1];
    if(oldX !== this.worldX || oldY !== this.worldY || forceTrigger === true) {
        this.trigger('new_display_state', this);
    }
};

Movable.prototype.moveTo = function(newX, newY) {
    if(newX !== null) { this.x = newX; }
    if(newY !== null) { this.y = newY; }
    this.trigger("new_state", this);
};

Movable.prototype.moveToFast = function(newX, newY) {
    this.x = newX;
    this.y = newY;
    this.trigger("new_state", this);
}

Movable.prototype.isBusy = function() {
    return this.currentTask !== null;
};

Movable.prototype.makeSureNotBusy = function() {
    if(this.isBusy()) {
        console.error("Attempt to use movable while it was busy", this);
        throw({message: "Object is busy - you should use callback", obj: this});
    }
};

Movable.prototype.wait = function(millis, cb) {
    this.makeSureNotBusy();
    var timeSpent = 0.0;
    var self = this;
    self.currentTask = function waitTask(dt) {
        timeSpent += dt;
        if(timeSpent > millis) {
            self.currentTask = null;
            if(cb) { cb(); }
        }
    };
};

Movable.prototype.moveToOverTime = function(newX, newY, timeToSpend, interpolator, cb) {
    this.makeSureNotBusy();
    this.currentTask = true;
    if(newX === null) { newX = this.x; }
    if(newY === null) { newY = this.y; }
    if(typeof interpolator === "undefined") { interpolator = DEFAULT_INTERPOLATOR; }
    var origX = this.x;
    var origY = this.y;
    var timeSpent = 0.0;
    var self = this;
    self.currentTask = function moveToOverTimeTask(dt) {
        timeSpent = Math.min(timeToSpend, timeSpent + dt);
        if(timeSpent === timeToSpend) { // Epsilon issues possibly?
            self.moveToFast(newX, newY);
            self.currentTask = null;
            if(cb) { cb(); }
        } else {
            var factor = timeSpent / timeToSpend;
            self.moveToFast(interpolator(origX, newX, factor), interpolator(origY, newY, factor));
        }
    };
};

Movable.prototype.update = function(dt) {
    if(this.currentTask !== null) {
        this.currentTask(dt);
    }
};

Movable.prototype.getWorldPosition = function(storage) {
    var resultX = this.x;
    var resultY = this.y;
    var currentParent = this.parent;
    while(currentParent !== null) {
        resultX += currentParent.x;
        resultY += currentParent.y;
        currentParent = currentParent.parent;
    }
    storage[0] = resultX;
    storage[1] = resultY;
};

Movable.prototype.setParent = function(movableParent) {
    var objWorld = [0,0];
    if(movableParent === null) {
        if(this.parent !== null) {
            this.getWorldPosition(objWorld);
            this.parent = null;
            this.moveToFast(objWorld[0], objWorld[1]);
        }
    } else {
        // Parent is being set a non-null movable
        this.getWorldPosition(objWorld);
        var parentWorld = [0,0];
        movableParent.getWorldPosition(parentWorld);
        this.parent = movableParent;
        this.moveToFast(objWorld[0] - parentWorld[0], objWorld[1] - parentWorld[1]);
    }
};
// Console shim
(function () {
    var f = function () {};
    if (!console) {
        console = {
            log:f, info:f, warn:f, debug:f, error:f
        };
    }
}());

var limitNumber = function(num, min, max) {
    return Math.min(max, Math.max(num, min));
};

var epsilonEquals = function(a, b) {
    return Math.abs(a-b) < 0.00000001;
};

// Polyfill from MDN
var sign = function(x) {
    x = +x; // convert to a number
    if (x === 0 || isNaN(x)){
        return x;
    }
    return x > 0 ? 1 : -1;
};
if(typeof Math.sign === "undefined") {
    Math.sign = sign;
}

var deprecationWarning = function(name) {
    console.warn("You are using a deprecated feature scheduled for removal: " + name);
};

var newGuard = function(obj, type) {
    if(!(obj instanceof type)) { throw "Incorrect instantiation, got " + typeof obj + " but expected " + type; }
}

var createBoolPassthroughFunction = function(owner, obj, objPropertyName) {
    return function(val) {
        if(typeof val !== "undefined") {
            obj[objPropertyName] = val ? true : false;
            obj.trigger("change:" + objPropertyName, obj[objPropertyName]);
            return owner;
        } else {
            return obj[objPropertyName];
        }
    };
};

distanceNeededToAchieveSpeed = function(currentSpeed, targetSpeed, acceleration) {
    // v² = u² + 2a * d
    var requiredDistance = (Math.pow(targetSpeed, 2) - Math.pow(currentSpeed, 2)) / (2 * acceleration);
    return requiredDistance;
};
accelerationNeededToAchieveChangeDistance = function(currentSpeed, targetSpeed, distance) {
    // v² = u² + 2a * d
    var requiredAcceleration = 0.5 * ((Math.pow(targetSpeed, 2) - Math.pow(currentSpeed, 2)) / distance);
    return requiredAcceleration;
};

// Fake frame requester helper used for testing and fitness simulations
var createFrameRequester = function(timeStep) {
    var currentCb = null;
    var requester = {};
    requester.currentT = 0.0;
    requester.register = function(cb) { currentCb = cb; };
    requester.trigger = function() { requester.currentT += timeStep; if(currentCb !== null) { currentCb(requester.currentT); } };
    return requester;
};

var getCodeObjFromCode = function(code) {
    if (code.trim().substr(0,1) == "{" && code.trim().substr(-1,1) == "}") {
        code = "(" + code + ")";
    }
    /* jslint evil:true */
    obj = eval(code);
    /* jshint evil:false */
    if(typeof obj.init !== "function") {
        throw "Code must contain an init function";
    }
    if(typeof obj.update !== "function") {
        throw "Code must contain an update function";
    }
    return obj;
}


// Interface that hides actual elevator object behind a more robust facade,
// while also exposing relevant events, and providing some helper queue
// functions that allow programming without async logic.
var asElevatorInterface = function(obj, elevator, floorCount, errorHandler) {
    var elevatorInterface = riot.observable(obj);

    elevatorInterface.destinationQueue = [];

    var tryTrigger = function(event, arg1, arg2, arg3, arg4) {
        try {
            elevatorInterface.trigger(event, arg1, arg2, arg3, arg4);
        } catch(e) { errorHandler(e); }
    };

    elevatorInterface.checkDestinationQueue = function() {
        if(!elevator.isBusy()) {
            if(elevatorInterface.destinationQueue.length) {
                elevator.goToFloor(_.first(elevatorInterface.destinationQueue));
            } else {
                tryTrigger("idle");
            }
        }
    };

    // TODO: Write tests for this queueing logic
    elevatorInterface.goToFloor = function(floorNum, forceNow) {
        floorNum = limitNumber(Number(floorNum), 0, floorCount - 1);
        // Auto-prevent immediately duplicate destinations
        if(elevatorInterface.destinationQueue.length) {
            var adjacentElement = forceNow ? _.first(elevatorInterface.destinationQueue) : _.last(elevatorInterface.destinationQueue);
            if(epsilonEquals(floorNum, adjacentElement)) {
                return;
            }
        }
        elevatorInterface.destinationQueue[(forceNow ? "unshift" : "push")](floorNum);
        elevatorInterface.checkDestinationQueue();
    };

    elevatorInterface.stop = function() {
        elevatorInterface.destinationQueue = [];
        if(!elevator.isBusy()) {
            elevator.goToFloor(elevator.getExactFutureFloorIfStopped());
        }
    };

    elevatorInterface.getFirstPressedFloor = function() { return elevator.getFirstPressedFloor(); }; // Undocumented and deprecated, will be removed
    elevatorInterface.getPressedFloors = function() { return elevator.getPressedFloors(); };
    elevatorInterface.currentFloor = function() { return elevator.currentFloor; };
    elevatorInterface.maxPassengerCount = function() { return elevator.maxUsers; };
    elevatorInterface.loadFactor = function() { return elevator.getLoadFactor(); };
    elevatorInterface.destinationDirection = function() {
      if(elevator.destinationY === elevator.y) { return "stopped"; }
      return elevator.destinationY > elevator.y ? "down" : "up";
    }
    elevatorInterface.goingUpIndicator = createBoolPassthroughFunction(elevatorInterface, elevator, "goingUpIndicator");
    elevatorInterface.goingDownIndicator = createBoolPassthroughFunction(elevatorInterface, elevator, "goingDownIndicator");

    elevator.on("stopped", function(position) {
        if(elevatorInterface.destinationQueue.length && epsilonEquals(_.first(elevatorInterface.destinationQueue), position)) {
            // Reached the destination, so remove element at front of queue
            elevatorInterface.destinationQueue = _.rest(elevatorInterface.destinationQueue);
            if(elevator.isOnAFloor()) {
                elevator.wait(1, function() {
                    elevatorInterface.checkDestinationQueue();
                });
            } else {
                elevatorInterface.checkDestinationQueue();
            }
        }
    });

    elevator.on("passing_floor", function(floorNum, direction) {
        tryTrigger("passing_floor", floorNum, direction);
    });

    elevator.on("stopped_at_floor", function(floorNum) {
        tryTrigger("stopped_at_floor", floorNum);
    });
    elevator.on("floor_button_pressed", function(floorNum) {
        tryTrigger("floor_button_pressed", floorNum);
    });

    return elevatorInterface;
};

var requireUserCountWithinTime = function(userCount, timeLimit) {
    return {
        description: "Transport <span class='emphasis-color'>" + userCount + "</span> people in <span class='emphasis-color'>" + timeLimit.toFixed(0) + "</span> seconds or less",
        evaluate: function(world) {
            if(world.elapsedTime >= timeLimit || world.transportedCounter >= userCount) {
                return world.elapsedTime <= timeLimit && world.transportedCounter >= userCount;
            } else {
                return null;
            }
        }
    };
};

var requireUserCountWithMaxWaitTime = function(userCount, maxWaitTime) {
    return {
        description: "Transport <span class='emphasis-color'>" + userCount + "</span> people and let no one wait more than <span class='emphasis-color'>" + maxWaitTime.toFixed(1) + "</span> seconds",
        evaluate: function(world) {
            if(world.maxWaitTime >= maxWaitTime || world.transportedCounter >= userCount) {
                return world.maxWaitTime <= maxWaitTime && world.transportedCounter >= userCount;
            } else {
                return null;
            }
        }
    };
};

var requireUserCountWithinTimeWithMaxWaitTime = function(userCount, timeLimit, maxWaitTime) {
    return {
       description: "Transport <span class='emphasis-color'>" + userCount + "</span> people in <span class='emphasis-color'>" + timeLimit.toFixed(0) + "</span> seconds or less and let no one wait more than <span class='emphasis-color'>" + maxWaitTime.toFixed(1) + "</span> seconds",
       evaluate: function(world) {
            if(world.elapsedTime >= timeLimit || world.maxWaitTime >= maxWaitTime || world.transportedCounter >= userCount) {
                return world.elapsedTime <= timeLimit && world.maxWaitTime <= maxWaitTime && world.transportedCounter >= userCount;
            } else {
                return null;
            }
       }
    };
};

var requireUserCountWithinMoves = function(userCount, moveLimit) {
    return {
        description: "Transport <span class='emphasis-color'>" + userCount + "</span> people using <span class='emphasis-color'>" + moveLimit + "</span> elevator moves or less",
        evaluate: function(world) {
            if(world.moveCount >= moveLimit || world.transportedCounter >= userCount) {
                return world.moveCount <= moveLimit && world.transportedCounter >= userCount;
            } else {
                return null;
            }
        }
    };
};

var requireDemo = function() {
    return {
        description: "Perpetual demo",
        evaluate: function() { return null; }
    };
};

/* jshint laxcomma:true */
var challenges = [
     {options: {floorCount: 3, elevatorCount: 1, spawnRate: 0.3}, condition: requireUserCountWithinTime(15, 60)}
    ,{options: {floorCount: 5, elevatorCount: 1, spawnRate: 0.4}, condition: requireUserCountWithinTime(20, 60)}
    ,{options: {floorCount: 5, elevatorCount: 1, spawnRate: 0.5, elevatorCapacities: [6]}, condition: requireUserCountWithinTime(23, 60)}
    ,{options: {floorCount: 8, elevatorCount: 2, spawnRate: 0.6}, condition: requireUserCountWithinTime(28, 60)}
    ,{options: {floorCount: 6, elevatorCount: 4, spawnRate: 1.7}, condition: requireUserCountWithinTime(100, 68)}
    ,{options: {floorCount: 4, elevatorCount: 2, spawnRate: 0.8}, condition: requireUserCountWithinMoves(40, 60)}
    ,{options: {floorCount: 3, elevatorCount: 3, spawnRate: 3.0}, condition: requireUserCountWithinMoves(100, 63)}
    ,{options: {floorCount: 6, elevatorCount: 2, spawnRate: 0.4, elevatorCapacities: [5]}, condition: requireUserCountWithMaxWaitTime(50, 21)}
    ,{options: {floorCount: 7, elevatorCount: 3, spawnRate: 0.6}, condition: requireUserCountWithMaxWaitTime(50, 20)}

    ,{options: {floorCount: 13, elevatorCount: 2, spawnRate: 1.1, elevatorCapacities: [4,10]}, condition: requireUserCountWithinTime(50, 70)}

    ,{options: {floorCount: 9, elevatorCount: 5, spawnRate: 1.1}, condition: requireUserCountWithMaxWaitTime(60, 19)}
    ,{options: {floorCount: 9, elevatorCount: 5, spawnRate: 1.1}, condition: requireUserCountWithMaxWaitTime(80, 17)}
    ,{options: {floorCount: 9, elevatorCount: 5, spawnRate: 1.1, elevatorCapacities: [5]}, condition: requireUserCountWithMaxWaitTime(100, 15)}
    ,{options: {floorCount: 9, elevatorCount: 5, spawnRate: 1.0, elevatorCapacities: [6]}, condition: requireUserCountWithMaxWaitTime(110, 15)}
    ,{options: {floorCount: 8, elevatorCount: 6, spawnRate: 0.9}, condition: requireUserCountWithMaxWaitTime(120, 14)}

    ,{options: {floorCount: 12, elevatorCount: 4, spawnRate: 1.4, elevatorCapacities: [5,10]}, condition: requireUserCountWithinTime(70, 80)}
    ,{options: {floorCount: 21, elevatorCount: 5, spawnRate: 1.9, elevatorCapacities: [10]}, condition: requireUserCountWithinTime(110, 80)}

    ,{options: {floorCount: 21, elevatorCount: 8, spawnRate: 1.5, elevatorCapacities: [6,8]}, condition: requireUserCountWithinTimeWithMaxWaitTime(2675, 1800, 45)}

    ,{options: {floorCount: 21, elevatorCount: 8, spawnRate: 1.5, elevatorCapacities: [6,8]}, condition: requireDemo()}
];
/* jshint laxcomma:false */

function clearAll($elems) {
    _.each($elems, function($elem) {
        $elem.empty();
    });
};

function setTransformPos(elem, x, y) {
    var style = "translate(" + x + "px," + y + "px) translateZ(0)";
    elem.style.transform = style;
    elem.style["-ms-transform"] = style;
    elem.style["-webkit-transform"] = style;
};

function updateUserState($user, elem_user, user) {
    setTransformPos(elem_user, user.worldX, user.worldY);
    if(user.done) { $user.addClass("leaving"); }
};


function presentStats($parent, world) {

    var elem_transportedcounter = $parent.find(".transportedcounter").get(0),
        elem_elapsedtime = $parent.find(".elapsedtime").get(0),
        elem_transportedpersec = $parent.find(".transportedpersec").get(0),
        elem_avgwaittime = $parent.find(".avgwaittime").get(0),
        elem_maxwaittime = $parent.find(".maxwaittime").get(0),
        elem_movecount = $parent.find(".movecount").get(0);

    world.on("stats_display_changed", function updateStats() {
        elem_transportedcounter.textContent = world.transportedCounter;
        elem_elapsedtime.textContent = world.elapsedTime.toFixed(0) + "s";
        elem_transportedpersec.textContent = world.transportedPerSec.toPrecision(3);
        elem_avgwaittime.textContent = world.avgWaitTime.toFixed(1) + "s";
        elem_maxwaittime.textContent = world.maxWaitTime.toFixed(1) + "s";
        elem_movecount.textContent = world.moveCount;
    });
    world.trigger("stats_display_changed");
};

function presentChallenge($parent, challenge, app, world, worldController, challengeNum, challengeTempl) {
    var $challenge = $(riot.render(challengeTempl, {
        challenge: challenge,
        num: challengeNum,
        timeScale: worldController.timeScale.toFixed(0) + "x",
        startButtonText: world.challengeEnded ? "<i class='fa fa-repeat'></i> Restart" : (worldController.isPaused ? "Start" : "Pause")
    }));
    $parent.html($challenge);

    $parent.find(".startstop").on("click", function() {
        app.startStopOrRestart();
    });
    $parent.find(".timescale_increase").on("click", function(e) {
        e.preventDefault();
        if(worldController.timeScale < 40) {
            var timeScale = Math.round(worldController.timeScale * 1.618);
            worldController.setTimeScale(timeScale);
        }
    });
    $parent.find(".timescale_decrease").on("click", function(e) {
        e.preventDefault();
        var timeScale = Math.round(worldController.timeScale / 1.618);
        worldController.setTimeScale(timeScale);
    });
};

function presentFeedback($parent, feedbackTempl, world, title, message, url) {
    $parent.html(riot.render(feedbackTempl, {title: title, message: message, url: url, paddingTop: world.floors.length * world.floorHeight * 0.2}));
    if(!url) {
        $parent.find("a").remove();
    }
};

function presentWorld($world, world, floorTempl, elevatorTempl, elevatorButtonTempl, userTempl) {
    $world.css("height", world.floorHeight * world.floors.length);

    $world.append(_.map(world.floors, function(f) {
        var $floor = $(riot.render(floorTempl, f));
        var $up = $floor.find(".up");
        var $down = $floor.find(".down");
        f.on("buttonstate_change", function(buttonStates) {
            $up.toggleClass("activated", buttonStates.up !== "");
            $down.toggleClass("activated", buttonStates.down !== "");
        });
        $up.on("click", function() {
            f.pressUpButton();
        });
        $down.on("click", function() {
            f.pressDownButton();
        });
        return $floor;
    }));
    $world.find(".floor").first().find(".down").addClass("invisible");
    $world.find(".floor").last().find(".up").addClass("invisible");

    function renderElevatorButtons(states) {
        // This is a rarely executed inner-inner loop, does not need efficiency
        return _.map(states, function(b, i) {
            return riot.render(elevatorButtonTempl, {floorNum: i});
        }).join("");
    };

    function setUpElevator(e) {
        var $elevator = $(riot.render(elevatorTempl, {e: e}));
        var elem_elevator = $elevator.get(0);
        $elevator.find(".buttonindicator").html(renderElevatorButtons(e.buttonStates));
        var $buttons = _.map($elevator.find(".buttonindicator").children(), function(c) { return $(c); });
        var elem_floorindicator = $elevator.find(".floorindicator > span").get(0);

        $elevator.on("click", ".buttonpress", function() {
            e.pressFloorButton(parseInt($(this).text()));
        });
        e.on("new_display_state", function updateElevatorPosition() {
            setTransformPos(elem_elevator, e.worldX, e.worldY);
        });
        e.on("new_current_floor", function update_current_floor(floor) {
            elem_floorindicator.textContent = floor;
        });
        e.on("floor_buttons_changed", function update_floor_buttons(states, indexChanged) {
            $buttons[indexChanged].toggleClass("activated", states[indexChanged]);
        });
        e.on("indicatorstate_change", function indicatorstate_change(indicatorStates) {
            $elevator.find(".up").toggleClass("activated", indicatorStates.up);
            $elevator.find(".down").toggleClass("activated", indicatorStates.down);
        });
        e.trigger("new_state", e);
        e.trigger("new_display_state", e);
        e.trigger("new_current_floor", e.currentFloor);
        return $elevator;
    }

    $world.append(_.map(world.elevators, function(e) {
        return setUpElevator(e);
    }));

    world.on("new_user", function(user) {
        var $user = $(riot.render(userTempl, {u: user, state: user.done ? "leaving" : ""}));
        var elem_user = $user.get(0);

        user.on("new_display_state", function() { updateUserState($user, elem_user, user); })
        user.on("removed", function() {
            $user.remove();
        });
        $world.append($user);
    });
};


function presentCodeStatus($parent, templ, error) {
    console.log(error);
    var errorDisplay = error ? "block" : "none";
    var successDisplay = error ? "none" : "block";
    var errorMessage = error;
    if(error && error.stack) {
        errorMessage = error.stack;
        errorMessage = errorMessage.replace(/\n/g, "<br>");
    }
    var status = riot.render(templ, {errorMessage: errorMessage, errorDisplay: errorDisplay, successDisplay: successDisplay});
    $parent.html(status);
};

function makeDemoFullscreen() {
    $("body .container > *").not(".world").css("visibility", "hidden");
    $("html, body, body .container, .world").css({width: "100%", margin: "0", "padding": 0});
};

var asFloor = function(obj, floorLevel, yPosition, errorHandler) {
    var floor = riot.observable(obj);

    floor.level = floorLevel;
    floor.yPosition = yPosition;
    floor.buttonStates = {up: "", down: ""};

    // TODO: Ideally the floor should have a facade where tryTrigger is done
    var tryTrigger = function(event, arg1, arg2, arg3, arg4) {
        try {
            floor.trigger(event, arg1, arg2, arg3, arg4);
        } catch(e) { errorHandler(e); }
    };

    floor.pressUpButton = function() {
        var prev = floor.buttonStates.up;
        floor.buttonStates.up = "activated";
        if(prev !== floor.buttonStates.up) {
            tryTrigger("buttonstate_change", floor.buttonStates);
            tryTrigger("up_button_pressed", floor);
        }
    };

    floor.pressDownButton = function() {
        var prev = floor.buttonStates.down;
        floor.buttonStates.down = "activated";
        if(prev !== floor.buttonStates.down) {
            tryTrigger("buttonstate_change", floor.buttonStates);
            tryTrigger("down_button_pressed", floor);
        }
    };

    floor.elevatorAvailable = function(elevator) {
        if(elevator.goingUpIndicator && floor.buttonStates.up) {
            floor.buttonStates.up = "";
            tryTrigger("buttonstate_change", floor.buttonStates);
        }
        if(elevator.goingDownIndicator && floor.buttonStates.down) {
            floor.buttonStates.down = "";
            tryTrigger("buttonstate_change", floor.buttonStates);
        }
    };

    floor.getSpawnPosY = function() {
        return floor.yPosition + 30;
    };

    floor.floorNum = function() {
        return floor.level;
    };

    return floor;
};



var createWorldCreator = function() {
    var creator = {};

    creator.createFloors = function(floorCount, floorHeight, errorHandler) {
        var floors = _.map(_.range(floorCount), function(e, i) {
            var yPos = (floorCount - 1 - i) * floorHeight;
            var floor = asFloor({}, i, yPos, errorHandler);
            return floor;
        });
        return floors;
    };
    creator.createElevators = function(elevatorCount, floorCount, floorHeight, elevatorCapacities) {
        elevatorCapacities = elevatorCapacities || [4];
        var currentX = 200.0;
        var elevators = _.map(_.range(elevatorCount), function(e, i) {
            var elevator = new Elevator(2.6, floorCount, floorHeight, elevatorCapacities[i%elevatorCapacities.length]);

            // Move to right x position
            elevator.moveTo(currentX, null);
            elevator.setFloorPosition(0);
            elevator.updateDisplayPosition();
            currentX += (20 + elevator.width);
            return elevator;
        });
        return elevators;
    };

    creator.createRandomUser = function() {
        var weight = _.random(55, 100);
        var user = new User(weight);
        if(_.random(40) === 0) {
            user.displayType = "child";
        } else if(_.random(1) === 0) {
            user.displayType = "female";
        } else {
            user.displayType = "male";
        }
        return user;
    };

    creator.spawnUserRandomly = function(floorCount, floorHeight, floors) {
        var user = creator.createRandomUser();
        user.moveTo(105+_.random(40), 0);
        var currentFloor = _.random(1) === 0 ? 0 : _.random(floorCount - 1);
        var destinationFloor;
        if(currentFloor === 0) {
            // Definitely going up
            destinationFloor = _.random(1, floorCount - 1);
        } else {
            // Usually going down, but sometimes not
            if(_.random(10) === 0) {
                destinationFloor = (currentFloor + _.random(1, floorCount - 1)) % floorCount;
            } else {
                destinationFloor = 0;
            }
        }
        user.appearOnFloor(floors[currentFloor], destinationFloor);
        return user;
    };

    creator.createWorld = function(options) {
        console.log("Creating world with options", options);
        var defaultOptions = { floorHeight: 50, floorCount: 4, elevatorCount: 2, spawnRate: 0.5 };
        options = _.defaults(_.clone(options), defaultOptions);
        var world = {floorHeight: options.floorHeight, transportedCounter: 0};
        riot.observable(world);

        var handleUserCodeError = function(e) {
            world.trigger("usercode_error", e);
        }

        world.floors = creator.createFloors(options.floorCount, world.floorHeight, handleUserCodeError);
        world.elevators = creator.createElevators(options.elevatorCount, options.floorCount, world.floorHeight, options.elevatorCapacities);
        world.elevatorInterfaces = _.map(world.elevators, function(e) { return asElevatorInterface({}, e, options.floorCount, handleUserCodeError); });
        world.users = [];
        world.transportedCounter = 0;
        world.transportedPerSec = 0.0;
        world.moveCount = 0;
        world.elapsedTime = 0.0;
        world.maxWaitTime = 0.0;
        world.avgWaitTime = 0.0;
        world.challengeEnded = false;

        var recalculateStats = function() {
            world.transportedPerSec = world.transportedCounter / world.elapsedTime;
            // TODO: Optimize this loop?
            world.moveCount = _.reduce(world.elevators, function(sum, elevator) { return sum+elevator.moveCount; }, 0);
            world.trigger("stats_changed");
        };

        var registerUser = function(user) {
            world.users.push(user);
            user.updateDisplayPosition(true);
            user.spawnTimestamp = world.elapsedTime;
            world.trigger("new_user", user);
            user.on("exited_elevator", function() {
                world.transportedCounter++;
                world.maxWaitTime = Math.max(world.maxWaitTime, world.elapsedTime - user.spawnTimestamp);
                world.avgWaitTime = (world.avgWaitTime * (world.transportedCounter - 1) + (world.elapsedTime - user.spawnTimestamp)) / world.transportedCounter;
                recalculateStats();
            });
            user.updateDisplayPosition(true);
        };

        var handleElevAvailability = function(elevator) {
            // Use regular loops for memory/performance reasons
            // Notify floors first because overflowing users
            // will press buttons again.
            for(var i=0, len=world.floors.length; i<len; ++i) {
                var floor = world.floors[i];
                if(elevator.currentFloor === i) {
                    floor.elevatorAvailable(elevator);
                }
            }
            for(var users=world.users, i=0, len=users.length; i < len; ++i) {
                var user = users[i];
                if(user.currentFloor === elevator.currentFloor) {
                    user.elevatorAvailable(elevator, world.floors[elevator.currentFloor]);
                }
            }
        };

        // Bind them all together
        for(var i=0; i < world.elevators.length; ++i) {
            world.elevators[i].on("entrance_available", handleElevAvailability);
        }

        var handleButtonRepressing = function(eventName, floor) {
            // Need randomize iteration order or we'll tend to fill upp first elevator
            for(var i=0, len=world.elevators.length, offset=_.random(len-1); i < len; ++i) {
                var elevIndex = (i + offset) % len;
                var elevator = world.elevators[elevIndex];
                if( eventName === "up_button_pressed" && elevator.goingUpIndicator ||
                    eventName === "down_button_pressed" && elevator.goingDownIndicator) {

                    // Elevator is heading in correct direction, check for suitability
                    if(elevator.currentFloor === floor.level && elevator.isOnAFloor() && !elevator.isMoving && !elevator.isFull()) {
                        // Potentially suitable to get into
                        // Use the interface queue functionality to queue up this action
                        world.elevatorInterfaces[elevIndex].goToFloor(floor.level, true);
                        return;
                    }
                }
            }
        }

        // This will cause elevators to "re-arrive" at floors if someone presses an
        // appropriate button on the floor before the elevator has left.
        for(var i=0; i<world.floors.length; ++i) {
            world.floors[i].on("up_button_pressed down_button_pressed", handleButtonRepressing);
        };

        var elapsedSinceSpawn = 1.001/options.spawnRate;
        var elapsedSinceStatsUpdate = 0.0;

        // Main update function
        world.update = function(dt) {
            world.elapsedTime += dt;
            elapsedSinceSpawn += dt;
            elapsedSinceStatsUpdate += dt;
            while(elapsedSinceSpawn > 1.0/options.spawnRate) {
                elapsedSinceSpawn -= 1.0/options.spawnRate;
                registerUser(creator.spawnUserRandomly(options.floorCount, world.floorHeight, world.floors));
            }

            // Use regular for loops for performance and memory friendlyness
            for(var i=0, len=world.elevators.length; i < len; ++i) {
                var e = world.elevators[i];
                e.update(dt);
                e.updateElevatorMovement(dt);
            }
            for(var users=world.users, i=0, len=users.length; i < len; ++i) {
                var u = users[i];
                u.update(dt);
                world.maxWaitTime = Math.max(world.maxWaitTime, world.elapsedTime - u.spawnTimestamp);
            };

            for(var users=world.users, i=world.users.length-1; i>=0; i--) {
                var u = users[i];
                if(u.removeMe) {
                    users.splice(i, 1);
                }
            }
            
            recalculateStats();
        };

        world.updateDisplayPositions = function() {
            for(var i=0, len=world.elevators.length; i < len; ++i) {
                world.elevators[i].updateDisplayPosition();
            }
            for(var users=world.users, i=0, len=users.length; i < len; ++i) {
                users[i].updateDisplayPosition();
            }
        };


        world.unWind = function() {
            console.log("Unwinding", world);
            _.each(world.elevators.concat(world.elevatorInterfaces).concat(world.users).concat(world.floors).concat([world]), function(obj) {
                obj.off("*");
            });
            world.challengeEnded = true;
            world.elevators = world.elevatorInterfaces = world.users = world.floors = [];
        };

        world.init = function() {
            // Checking the floor queue of the elevators triggers the idle event here
            for(var i=0; i < world.elevatorInterfaces.length; ++i) {
                world.elevatorInterfaces[i].checkDestinationQueue();
            }
        };

        return world;
    };

    return creator;
};


var createWorldController = function(dtMax) {
    var controller = riot.observable({});
    controller.timeScale = 1.0;
    controller.isPaused = true;
    controller.start = function(world, codeObj, animationFrameRequester, autoStart) {
        controller.isPaused = true;
        var lastT = null;
        var firstUpdate = true;
        world.on("usercode_error", controller.handleUserCodeError);
        var updater = function(t) {
            if(!controller.isPaused && !world.challengeEnded && lastT !== null) {
                if(firstUpdate) {
                    firstUpdate = false;
                    // This logic prevents infite loops in usercode from breaking the page permanently - don't evaluate user code until game is unpaused.
                    try {
                        codeObj.init(world.elevatorInterfaces, world.floors);
                        world.init();
                    } catch(e) { controller.handleUserCodeError(e); }
                }

                var dt = (t - lastT);
                var scaledDt = dt * 0.001 * controller.timeScale;
                scaledDt = Math.min(scaledDt, dtMax * 3 * controller.timeScale); // Limit to prevent unhealthy substepping
                try {
                    codeObj.update(scaledDt, world.elevatorInterfaces, world.floors);
                } catch(e) { controller.handleUserCodeError(e); }
                while(scaledDt > 0.0 && !world.challengeEnded) {
                    var thisDt = Math.min(dtMax, scaledDt);
                    world.update(thisDt);
                    scaledDt -= dtMax;
                }
                world.updateDisplayPositions();
                world.trigger("stats_display_changed"); // TODO: Trigger less often for performance reasons etc
            }
            lastT = t;
            if(!world.challengeEnded) {
                animationFrameRequester(updater);
            }
        };
        if(autoStart) {
            controller.setPaused(false);
        }
        animationFrameRequester(updater);
    };

    controller.handleUserCodeError = function(e) {
        controller.setPaused(true);
        console.log("Usercode error on update", e);
        controller.trigger("usercode_error", e);
    };

    controller.setPaused = function(paused) {
        controller.isPaused = paused;
        controller.trigger("timescale_changed");
    };
    controller.setTimeScale = function(timeScale) {
        controller.timeScale = timeScale;
        controller.trigger("timescale_changed");
    };

    return controller;
};
function User(weight) {
    newGuard(this, User);
    Movable.call(this);
    var user = this;
    user.weight = weight;
    user.currentFloor = 0;
    user.destinationFloor = 0;
    user.done = false;
    user.removeMe = false;
};
User.prototype = Object.create(Movable.prototype);


User.prototype.appearOnFloor = function(floor, destinationFloorNum) {
    var floorPosY = floor.getSpawnPosY();
    this.currentFloor = floor.level;
    this.destinationFloor = destinationFloorNum;
    this.moveTo(null, floorPosY);
    this.pressFloorButton(floor);
};

User.prototype.pressFloorButton = function(floor) {
    if(this.destinationFloor < this.currentFloor) {
        floor.pressDownButton();
    } else {
        floor.pressUpButton();
    }
};

User.prototype.handleExit = function(floorNum, elevator) {
    if(elevator.currentFloor === this.destinationFloor) {
        elevator.userExiting(this);
        this.currentFloor = elevator.currentFloor;
        this.setParent(null);
        var destination = this.x + 100;
        this.done = true;
        this.trigger("exited_elevator", elevator);
        this.trigger("new_state");
        this.trigger("new_display_state");
        var self = this;
        this.moveToOverTime(destination, null, 1 + Math.random()*0.5, linearInterpolate, function lastMove() {
            self.removeMe = true;
            self.trigger("removed");
            self.off("*");
        });

        elevator.off("exit_available", this.exitAvailableHandler);
    }
};

User.prototype.elevatorAvailable = function(elevator, floor) {
    if(this.done || this.parent !== null || this.isBusy()) {
        return;
    }

    if(!elevator.isSuitableForTravelBetween(this.currentFloor, this.destinationFloor)) {
        // Not suitable for travel - don't use this elevator
        return;
    }

    var pos = elevator.userEntering(this);
    if(pos) {
        // Success
        this.setParent(elevator);
        this.trigger("entered_elevator", elevator);
        var self = this;
        this.moveToOverTime(pos[0], pos[1], 1, undefined, function() {
            elevator.pressFloorButton(self.destinationFloor);
        });
        this.exitAvailableHandler = function (floorNum, elevator) { self.handleExit(elevator.currentFloor, elevator); };
        elevator.on("exit_available", this.exitAvailableHandler);
    } else {
        this.pressFloorButton(floor);
    }
};
function newElevStateHandler(elevator) { elevator.handleNewState(); }

function Elevator(speedFloorsPerSec, floorCount, floorHeight, maxUsers) {
    newGuard(this, Elevator);
    Movable.call(this);
    var elevator = this;

    elevator.ACCELERATION = floorHeight * 2.1;
    elevator.DECELERATION = floorHeight * 2.6;
    elevator.MAXSPEED = floorHeight * speedFloorsPerSec;
    elevator.floorCount = floorCount;
    elevator.floorHeight = floorHeight;
    elevator.maxUsers = maxUsers || 4;
    elevator.destinationY = 0.0;
    elevator.velocityY = 0.0;
    // isMoving flag is needed when going to same floor again - need to re-raise events
    elevator.isMoving = false;

    elevator.goingDownIndicator = true;
    elevator.goingUpIndicator = true;

    elevator.currentFloor = 0;
    elevator.previousTruncFutureFloorIfStopped = 0;
    elevator.buttonStates = _.map(_.range(floorCount), function(e, i){ return false; });
    elevator.moveCount = 0;
    elevator.removed = false;
    elevator.userSlots = _.map(_.range(elevator.maxUsers), function(user, i) {
        return { pos: [2 + (i * 10), 30], user: null};
    });
    elevator.width = elevator.maxUsers * 10;
    elevator.destinationY = elevator.getYPosOfFloor(elevator.currentFloor);

    elevator.on("new_state", newElevStateHandler);

    elevator.on("change:goingUpIndicator", function(value){
        elevator.trigger("indicatorstate_change", {up: elevator.goingUpIndicator, down: elevator.goingDownIndicator});
    });

    elevator.on("change:goingDownIndicator", function(value){
        elevator.trigger("indicatorstate_change", {up: elevator.goingUpIndicator, down: elevator.goingDownIndicator});
    });
};
Elevator.prototype = Object.create(Movable.prototype);

Elevator.prototype.setFloorPosition = function(floor) {
    var destination = this.getYPosOfFloor(floor);
    this.currentFloor = floor;
    this.previousTruncFutureFloorIfStopped = floor;
    this.moveTo(null, destination);
};

Elevator.prototype.userEntering = function(user) {
    var randomOffset = _.random(this.userSlots.length - 1);
    for(var i=0; i<this.userSlots.length; i++) {
        var slot = this.userSlots[(i + randomOffset) % this.userSlots.length];
        if(slot.user === null) {
            slot.user = user;
            return slot.pos;
        }
    }
    return false;
};

Elevator.prototype.pressFloorButton = function(floorNumber) {
    var prev;
    floorNumber = limitNumber(floorNumber, 0, this.floorCount - 1);
    prev = this.buttonStates[floorNumber];
    this.buttonStates[floorNumber] = true;
    if(!prev) {
        this.trigger("floor_button_pressed", floorNumber);
        this.trigger("floor_buttons_changed", this.buttonStates, floorNumber);
    }
};

Elevator.prototype.userExiting = function(user) {
    for(var i=0; i<this.userSlots.length; i++) {
        var slot = this.userSlots[i];
        if(slot.user === user) {
            slot.user = null;
        }
    }
};

Elevator.prototype.updateElevatorMovement = function(dt) {
    if(this.isBusy()) {
        // TODO: Consider if having a nonzero velocity here should throw error..
        return;
    }

    // Make sure we're not speeding
    this.velocityY = limitNumber(this.velocityY, -this.MAXSPEED, this.MAXSPEED);

    // Move elevator
    this.moveTo(null, this.y + this.velocityY * dt);

    var destinationDiff = this.destinationY - this.y;
    var directionSign = Math.sign(destinationDiff);
    var velocitySign = Math.sign(this.velocityY);
    var acceleration = 0.0;
    if(destinationDiff !== 0.0) {
        if(directionSign === velocitySign) {
            // Moving in correct direction
            var distanceNeededToStop = distanceNeededToAchieveSpeed(this.velocityY, 0.0, this.DECELERATION);
            if(distanceNeededToStop * 1.05 < -Math.abs(destinationDiff)) {
                // Slow down
                // Allow a certain factor of extra breaking, to enable a smooth breaking movement after detecting overshoot
                var requiredDeceleration = accelerationNeededToAchieveChangeDistance(this.velocityY, 0.0, destinationDiff);
                var deceleration = Math.min(this.DECELERATION*1.1, Math.abs(requiredDeceleration));
                this.velocityY -= directionSign * deceleration * dt;
            } else {
                // Speed up (or keep max speed...)
                acceleration = Math.min(Math.abs(destinationDiff*5), this.ACCELERATION);
                this.velocityY += directionSign * acceleration * dt;
            }
        } else if(velocitySign === 0) {
            // Standing still - should accelerate
            acceleration = Math.min(Math.abs(destinationDiff*5), this.ACCELERATION);
            this.velocityY += directionSign * acceleration * dt;
        } else {
            // Moving in wrong direction - decelerate as much as possible
            this.velocityY -= velocitySign * this.DECELERATION * dt;
            // Make sure we don't change direction within this time step - let standstill logic handle it
            if(Math.sign(this.velocityY) !== velocitySign) {
                this.velocityY = 0.0;
            }
        }
    }

    if(this.isMoving && Math.abs(destinationDiff) < 0.5 && Math.abs(this.velocityY) < 3) {
        // Snap to destination and stop
        this.moveTo(null, this.destinationY);
        this.velocityY = 0.0;
        this.isMoving = false;
        this.handleDestinationArrival();
    }
};

Elevator.prototype.handleDestinationArrival = function() {
    this.trigger("stopped", this.getExactCurrentFloor());

    if(this.isOnAFloor()) {
        this.buttonStates[this.currentFloor] = false;
        this.trigger("floor_buttons_changed", this.buttonStates, this.currentFloor);
        this.trigger("stopped_at_floor", this.currentFloor);
        // Need to allow users to get off first, so that new ones
        // can enter on the same floor
        this.trigger("exit_available", this.currentFloor, this);
        this.trigger("entrance_available", this);
    }
};

Elevator.prototype.goToFloor = function(floor) {
    this.makeSureNotBusy();
    this.isMoving = true;
    this.destinationY = this.getYPosOfFloor(floor);
};

Elevator.prototype.getFirstPressedFloor = function() {
    deprecationWarning("getFirstPressedFloor");
    for(var i=0; i<this.buttonStates.length; i++) {
        if(this.buttonStates[i]) { return i; }
    }
    return 0;
};

Elevator.prototype.getPressedFloors = function() {
    for(var i=0, arr=[]; i<this.buttonStates.length; i++) {
        if(this.buttonStates[i]) {
            arr.push(i);
        }
    }
    return arr;
};

Elevator.prototype.isSuitableForTravelBetween = function(fromFloorNum, toFloorNum) {
    if(fromFloorNum > toFloorNum) { return this.goingDownIndicator; }
    if(fromFloorNum < toFloorNum) { return this.goingUpIndicator; }
    return true;
};

Elevator.prototype.getYPosOfFloor = function(floorNum) {
    return (this.floorCount - 1) * this.floorHeight - floorNum * this.floorHeight;
};

Elevator.prototype.getExactFloorOfYPos = function(y) {
    return ((this.floorCount - 1) * this.floorHeight - y) / this.floorHeight;
};

Elevator.prototype.getExactCurrentFloor = function() {
    return this.getExactFloorOfYPos(this.y);
};

Elevator.prototype.getDestinationFloor = function() {
    return this.getExactFloorOfYPos(this.destinationY);
};

Elevator.prototype.getRoundedCurrentFloor = function() {
    return Math.round(this.getExactCurrentFloor());
};

Elevator.prototype.getExactFutureFloorIfStopped = function() {
    var distanceNeededToStop = distanceNeededToAchieveSpeed(this.velocityY, 0.0, this.DECELERATION);
    return this.getExactFloorOfYPos(this.y - Math.sign(this.velocityY) * distanceNeededToStop);
};

Elevator.prototype.isApproachingFloor = function(floorNum) {
    var floorYPos = this.getYPosOfFloor(floorNum);
    var elevToFloor = floorYPos - this.y;
    return this.velocityY !== 0.0 && (Math.sign(this.velocityY) === Math.sign(elevToFloor));
};

Elevator.prototype.isOnAFloor = function() {
    return epsilonEquals(this.getExactCurrentFloor(), this.getRoundedCurrentFloor());
};

Elevator.prototype.getLoadFactor = function() {
    var load = _.reduce(this.userSlots, function(sum, slot) { return sum + (slot.user ? slot.user.weight : 0); }, 0);
    return load / (this.maxUsers * 100);
};

Elevator.prototype.isFull = function() {
    for(var i=0; i<this.userSlots.length; i++) { if(this.userSlots[i].user === null) { return false; } }
    return true;
};
Elevator.prototype.isEmpty = function() {
    for(var i=0; i<this.userSlots.length; i++) { if(this.userSlots[i].user !== null) { return false; } }
    return true;
};

Elevator.prototype.handleNewState = function() {
    // Recalculate the floor number etc
    var currentFloor = this.getRoundedCurrentFloor();
    if(currentFloor !== this.currentFloor) {
        this.moveCount++;
        this.currentFloor = currentFloor;
        this.trigger("new_current_floor", this.currentFloor);
    }

    // Check if we are about to pass a floor
    var futureTruncFloorIfStopped = Math.trunc(this.getExactFutureFloorIfStopped());
    if(futureTruncFloorIfStopped !== this.previousTruncFutureFloorIfStopped) {
        // The following is somewhat ugly.
        // A formally correct solution should iterate and generate events for all passed floors,
        // because the elevator could theoretically have such a velocity that it would
        // pass more than one floor over the course of one state change (update).
        // But I can't currently be arsed to implement it because it's overkill.
        var floorBeingPassed = Math.round(this.getExactFutureFloorIfStopped());

        // Never emit passing_floor event for the destination floor
        // Because if it's the destination we're not going to pass it, at least not intentionally
        if(this.getDestinationFloor() !== floorBeingPassed && this.isApproachingFloor(floorBeingPassed)) {
            var direction = this.velocityY > 0.0 ? "down" : "up";
            this.trigger("passing_floor", floorBeingPassed, direction);
        }
    }
    this.previousTruncFutureFloorIfStopped = futureTruncFloorIfStopped;
};
newGuard = function(){}; module.exports = { createWorldCreator, createWorldController, challenges, getCodeObjFromCode };
