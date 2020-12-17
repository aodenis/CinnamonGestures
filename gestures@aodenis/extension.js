// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

// Copyright (C) 2020 Aodenis

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

const Clutter = imports.gi.Clutter;
const Meta = imports.gi.Meta;
const Signals = imports.signals;
const Lang = imports.lang;
const St = imports.gi.St;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const WindowUtils = imports.misc.windowUtils;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const Settings = imports.ui.settings;

// Slope : the higher the faster the animation
// Tau : the lower the faster the animation

const FRAME_RATE = 120;
const TAU_CONTROLLED = 32; // milliseconds
const SLOPE_CONTROLLED = 1/TAU_CONTROLLED; //0.5 works (when it's 1000/(FRAME_RATE*TAU_CONTROLLED))
const TAU_NOT_CONTROLLED = 64; // milliseconds
const SLOPE_NOT_CONTROLLED = 1/TAU_NOT_CONTROLLED; //0.5 works
const SWITCH_CONTROLLED_SLOPE_FACTOR = 1/2;
const SWITCH_NOT_CONTROLLED_SLOPE_FACTOR = 0.8;
const SWITCH_OVERDRAFT_SLOPE = SLOPE_NOT_CONTROLLED*1.5;
const ADDED_RATIO_HOVER = 0.1;
const ADDED_RATIO_HOVER_WORKSPACE = 0.05;
const MARGIN_BETWEEN_WORKSPACES = 100; //px
const WINDOW_SWITCH_FACTOR = 3000;
const WINDOW_SWITCH_WEIGHT = 3;
const WORKSPACE_LOAD_THRESHOLD = 0.9;
const WORKSPACE_CREATION_THRESHOLD = 300000;
const MINIMIZING_WINDOW_SLOPE_FACTOR = 0.8;
const DEFAULT_SLOT_FRACTION = 0.825;
const DEFAULT_WORKSPACE_SLOT_FRACTION = 0.95;

const DIRT_TYPE = {WINDOW: 1, WORKSPACE_OVERVIEW: 2, WORKSPACE_SWITCH: 4, FINE_CONTROL: 8, ELEMENT_POSITIONS: 32, WINDOW_SWITCH: 64, HOVER: 128, SELF_POSITION: 256, RETAIN_COUNT: 512};
const ANIMATION_DIRECTION = {FORWARD: 1, BACKWARDS: 2};

var last_error = undefined;
var hyperWorkspacesStableSequence = 1;

// RELEASE
// TODO Plus button for new workspaces in mode 2
// TODO Drag windows to other workspaces
// TODO Expo/Overview inhibition
// TODO view desktop
// TODO Multidisplay support
// TODO Better vindow titles
// Smoother

// FUTURE
// TODO Improve window switch
// TODO keyboard support
// TODO Windows asking attention
// TODO ClutterRectangle.set_color is deprecated (but it works)
// TODO General performance improvement
// TODO Better window placement ?

// FAR FUTURE
// TODO Some JS code can go into C one
// TODO Motion blur maybe

// VISUAL GLITCHES
// Good theme for Message when no window (not that easy !)
// Windows shadows handling
// New windows in mode 1 can be buggy
// Windows not updated after workspaces removal
// Overview window activation
// Hover fix
// Window minimization animation intended only for lower or upper panel, not for side panels
// Many others

function logStack()
{
    try
    {
        var a = undefined;
        a.b = 0;
    }
    catch(e)
    {
        global.logWarning(e.stack);
    }
}

function print_error(e)
{
    if(last_error !== undefined)
    {
        if((last_error.message === e.message) && (last_error.lineNumber === e.lineNumber))return;
    }
    last_error = {message: e.message, lineNumber: e.lineNumber};
    let additionalError = null;
    if(mngr !== null)
    {
        let str = e.message + "\n" +e.lineNumber.toString() + "\n" + e.stack + "\n";
        try
        {
            mngr.logToFile(str);
        }
        catch(e2)
        {
            additionalError = e2;
        }
    }
    global.logError(e.message);
    global.logError(e.lineNumber);
    global.logWarning(e.stack);
    if(additionalError !== null)
    {
        global.logWarning("--- Additional error when trying to log to file ---");
        global.logError(additionalError.message);
        global.logError(additionalError.lineNumber);
        global.logWarning(additionalError.stack);
    }
}

function gTime() //milliseconds
{
    return (new Date()).getTime();
}

function interpolate(from, to, prog)
{
    return from*(1-prog) + to*prog;
}

function clamp(a, min, max)
{
    if(a < min)return min;
    if(a > max)return max;
    return a;
}

function clamplog(a, min, max, _b)
{
    let b = (_b === undefined)?1:_b;
    if(a > max)return b*(Math.log(a-max+b)-Math.log(b))+max;
    else if(a < min)return -b*(Math.log(min-a+b)-Math.log(b))+min;
    else return a;
}

function protect(func)
{
    return (function()
    {
        try
        {
            func.apply(this, arguments);
        }
        catch(e)
        {
            print_error(e)
        }
    }).bind(this)
}

var found_debug_wrong_var = false;
function debug_check_vars()
{
    if(found_debug_wrong_var)return;
    for(let i = 0; i < arguments.length; i++){
        let x = arguments[i]
        if((typeof(x) !== "number")||(isNaN(x)))
        {
            logStack();
            global.logWarning("Variable index : " + i.toString())
            global.log("Variables :", Object.values(arguments))
            found_debug_wrong_var = true;
            break;
        }
    }
}

class SettingsManager {
    constructor()
    {
        this.devMode = true; // Unused
        this.debugMode = false; // Red square when activated
        this.windowSwitchEnabled = false; // An unfinished feature. Working but visually broken
        this.debugLogFileDisabled = !this.devMode; // Barely used, created only if used
        this.fourFingersCinnamonRestart = this.devMode; // Put four fingers, move a bit to trigger events but not too much, wait, Cinnamon restarts
        this.settings = new Settings.ExtensionSettings(this, "gestures@aodenis");
        //this.settings.bindProperty(Settings.BindingDirection.IN, "dev-mode", "devMode", null, null);
        //this.settings.bindProperty(Settings.BindingDirection.IN, "debug-mode", "debugMode", null, null);
        this.settings.bindProperty(Settings.BindingDirection.IN, "window-switch-enabled", "windowSwitchEnabled", null, null);
        //this.settings.bindProperty(Settings.BindingDirection.IN, "debug-log-file-disabled", "debugLogFileDisabled", null, null);
        //this.settings.bindProperty(Settings.BindingDirection.IN, "four-fingers-cinnamon-restart", "fourFingersCinnamonRestart", null, null);
    }
}

class ProgressEngine {
    constructor()
    {
        this.updateInterval = null;
        this.tickers = {};
        this.currentTime = gTime();
        this.inTick = false;
        this.increasing = 0;
        this.dirtyParts = [[], [], []];
        this.start_date = undefined;
    }

    onTick()
    {
        try
        {
            this.inTick = true;
            let dt = gTime()-this.currentTime; //1000 / FRAME_RATE;
            this.currentTime += dt;
            let tickers = Object.values(this.tickers);
            tickers.forEach((ticker)=>{
                if(!ticker.paused)ticker.onTick(this.currentTime, dt);
            });
            
            for(let i = 0; i < 3; i++)
            {
                let dirt = this.dirtyParts[i];
                this.dirtyParts[i] = dirt.filter(x=>x.onClean());
            }

            this.inTick = false;

            let activeTickerCount = Object.keys(this.tickers).length;
            if(activeTickerCount !== 0)return true;
            else
            {
                this.updateInterval = null;
                return false;
            }
        }
        catch(e)
        {
            print_error(e);
        }
    }

    destroy()
    {
        if(this.updateInterval !== null)GLib.source_remove(this.updateInterval); //pretty disgusting ! What if we are in a tick now ? Hmm...
        this.updateInterval = null;
        this.tickers = {};
    }

    registerTicker(n_ticker)
    {
        n_ticker.id = this.increasing;
        this.increasing++;
        if(!n_ticker.paused)this.tickers[n_ticker.id.toString()] = n_ticker;
        this.syncTimer();
    }

    forgetTicker(ticker)
    {
        if(!ticker.paused)delete this.tickers[ticker.id.toString()];
        this.syncTimer();
    }

    registerDirty(priority, dirt)
    {
        this.dirtyParts[priority].push(dirt);
        this.syncTimer();
    }

    notifyPauseChange(ticker)
    {
        if(ticker.paused)delete this.tickers[ticker.id.toString()];
        else this.tickers[ticker.id.toString()] = ticker;
        this.syncTimer();
    }

    syncTimer()
    {
        if(this.inTick)return; //not the time to do so !
        let activityCount = Object.keys(this.tickers).length + this.dirtyParts[0].length + this.dirtyParts[1].length + this.dirtyParts[2].length;
        if((this.updateInterval !== null) && (activityCount === 0))
        {
            // nothing to do, should stop this.
            GLib.source_remove(this.updateInterval);
            this.updateInterval = null;
        }
        if((this.updateInterval === null) && (activityCount > 0))
        {
            //should start ticking
            this.currentTime = gTime();
            this.updateInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.floor(1000 / FRAME_RATE), this.onTick.bind(this));
        }
    }

    logState()
    {
        mngr.logToFile(JSON.stringify(this))
    }
};

class Progress {
    constructor(options)
    {
        this.options = {};
        Object.keys(options).forEach((key)=>{
            this.options[key] = options[key];
        });
        this.paused = true;
        this.target = this.options.defaultToUndefined?undefined:0;
        this.progress = this.target;
        this.unit_progress = this.progress/1000000;
        mngr.engine.registerTicker(this);
    }

    setTarget(n_target)
    {
        if(n_target === null)logStack();
        this.target = n_target;
        if(this.target !== this.progress)this.setPaused(false);
        if(this.progress === undefined)
        {
            this.progress = n_target;
            this.old_progress = n_target;
        }
    }

    onTick(time, dt)
    {
        let {slope, max, min, callback, stickAroundTarget, float} = this.options;
        let new_progress = this.progress;
        if(this.progress !== undefined)
        {
            new_progress += (dt*slope*(this.target-this.progress));
            if(!float)new_progress = Math.round(new_progress);
            if(Math.abs(new_progress-this.target) <= stickAroundTarget)new_progress = this.target;
        }
        else new_progress = this.target;
        if(new_progress !== undefined)
        {
            if((min !== undefined) && (new_progress < min))new_progress = min;
            if((max !== undefined) && (new_progress > max))new_progress = max;
        }
        this.old_progress = this.progress;
        this.progress = new_progress;
        this.unit_progress = this.progress/1000000;
        if((new_progress === this.old_progress) && (this.progress === this.target))this.setPaused(true);
        else callback(new_progress, this.old_progress);
    }

    destroy()
    {
        if((mngr !== undefined) && (mngr.engine !== undefined))mngr.engine.forgetTicker(this);
        else if(!this.paused)global.logWarning("Manager destroyer while a ticker was still ticking");
    }

    setPaused(n_paused)
    {
        if(n_paused !== this.paused)
        {
            this.paused = n_paused;
            mngr.engine.notifyPauseChange(this);
            if(this.options.onPauseChange !== undefined)
            {
                this.options.onPauseChange(n_paused)
            }
        }
    }

    setTargetToClosestGoal()
    {
        let goals = this.options.goals;
        let foundGoal = goals.reduce(((acc, cV) => (acc===undefined)?cV:((Math.abs(acc - this.progress) < Math.abs(cV - this.progress))?acc:cV)), undefined);
        if(foundGoal !== undefined)this.setTarget(foundGoal);
        else global.logWarning("setTargetToClosestGoal called with empty goal set");
    }

    setTargetToClosestGoalWithDirection(direction, minDelta)
    {
        let goals = this.options.goals;
        let foundGoal = goals.reduce(((acc, cV) => (acc===undefined)?cV:((Math.abs(acc - this.progress) < Math.abs(cV - this.progress))?acc:cV)), undefined);
        if(foundGoal === undefined)
        {
            global.logWarning("setTargetToClosestGoal called with empty goal set");
            return;
        }
        if((this.progress > (foundGoal + minDelta)) && (direction==="right"))
        {
            let i = goals.findIndex((x)=>(foundGoal===x))
            if((i+1) < goals.length)foundGoal = goals[i+1]
        }
        else if((this.progress < (foundGoal - minDelta)) && (direction==="left"))
        {
            let i = goals.findIndex((x)=>(foundGoal===x))
            if(i > 0)foundGoal = goals[i-1]
        }
        this.setTarget(foundGoal);
    }

    onGoal()
    {
        if(this.options.goals)return (this.options.goals.find((x)=>(x===this.progress)) === this.progress);
        else return false;
    }

    jumpTo(x) // for seamless jumps ONLY
    {
        this.progress = x;
        this.old_progress = x;
        this.target = x;
    }

    fullJumpTo(p,op,t) // for seamless jumps ONLY
    {
        this.progress = p;
        this.old_progress = op;
        this.setTarget(t);
    }
};

class ModularProgress {
    constructor(options)
    {
        this.options = {};
        Object.keys(options).forEach((key)=>{
            this.options[key] = options[key];
        });
        this.paused = true;
        this.target = 0;
        this.progress = 0;
        mngr.engine.registerTicker(this);
    }

    addDelta(delta)
    {
        this.target += delta;
        if(this.target !== this.progress)this.setPaused(false);
    }

    onTick(time, dt)
    {
        let {slope, callback, stickAroundTarget} = this.options;
        let new_progress = this.progress;
        new_progress += Math.round(dt*slope*(this.target-this.progress));
        if(Math.abs(new_progress-this.target) <= stickAroundTarget)new_progress = this.target;
        this.decay = Math.round(new_progress/1000000);
        this.target -= 1000000*this.decay;
        new_progress -= 1000000*this.decay;
        this.old_progress = this.progress;
        this.progress = new_progress;
        this.unit_progress = this.progress/1000000;
        if((new_progress === this.old_progress) && (this.decay === 0) && (this.target===new_progress))this.setPaused(true);
        else callback(new_progress, this.old_progress, this.decay);
    }

    destroy()
    {
        if((mngr !== undefined) && (mngr.engine !== undefined))mngr.engine.forgetTicker(this);
        else if(!this.paused)global.logWarning("Manager destroyer while a ticker was still ticking");
    }

    setPaused(value)
    {
        if(value !== this.paused)
        {
            this.paused = value;
            mngr.engine.notifyPauseChange(this);
        }
    }

    setTargetToClosestGoal()
    {
        this.target = 0;
        if(this.progress)this.setPaused(false);
    }

    onGoal()
    {
        return (this.progress === 0);
    }
};

class HyperviewWindow {
    constructor(hyperWorkspace, realWindow) {
        // Store everything needed

        this.hyperWorkspace = hyperWorkspace;
        this.hyperview = this.hyperWorkspace.hyperview;
        this.realWindow = realWindow;
        this.metaWindow = realWindow.meta_window;
        this.identifier = this.hyperWorkspace.stableIndex + "_" + this.metaWindow.get_stable_sequence().toString();
        this.metaWorkspace = this.hyperWorkspace.metaWorkspace;

        // Build view

        this.caption = new St.BoxLayout({ style_class: 'window-caption', name: "title"});
        this.caption._spacing = 0;
        this.title = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
        this.title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.caption.add_actor(this.title);

        this.actor = new Clutter.Group({reactive: true, name: "HyperWindow "+this.identifier});
        this.actor.set_pivot_point(0.5, 0.5);
        this.refreshClone(true);
        
        // Initialize window variables and bind them

        this.minimizedScale = 0.1;
        this.destScale = 1.0;
        this.thumbnailLocation = {x: -1, y: -1};
        this.windowLocation = {x: -1, y: -1};
        this.minimizedLocation = {x: -1, y: -1};
        this.onPositionChanged();
        this.destPosXProgress = new Progress({float: true,  defaultToUndefined: true, slope: SLOPE_NOT_CONTROLLED, callback: this.onDestPosTick.bind(this), stickAroundTarget: 1});
        this.destPosYProgress = new Progress({float: true,  defaultToUndefined: true, slope: SLOPE_NOT_CONTROLLED, callback: this.onDestPosTick.bind(this), stickAroundTarget: 1});
        this.minimizerProgress = new Progress({ slope: SLOPE_CONTROLLED, callback: this.onMinimizerTick.bind(this), stickAroundTarget: 90, stickAroundGoals: 90, goals: [0, 1000000], max: 1000000, min: 0, onPauseChange: this.protect(this.onMinimizerPauseChange)});
        this.realActorConnectionIds = [this.realWindow.connect('position-changed', this.protect(this.onPositionChanged)), this.realWindow.connect('size-changed', this.protect(this.onSizeChanged))];
        
        this.hoverProgress = new Progress({ slope: SLOPE_CONTROLLED, callback: this.onHoverTick.bind(this), stickAroundTarget: 90, stickAroundGoals: 90, goals: [0,1000000], max: 1000000, min: 0});
        this.connectionIds = Array();
        this.connectionIds.push(this.actor.connect('motion-event', this.protect(this.motionEvent)));
        this.connectionIds.push(this.actor.connect('leave-event', this.protect(this.leaveEvent)));
        this.connectionIds.push(this.actor.connect('button-press-event', this.protect(this.buttonPressEvent)));
        this.connectionIds.push(this.actor.connect('button-release-event', this.protect(this.buttonReleaseEvent)));
        this.metaWindowConnectionsIds = Array();
        this.metaWindowConnectionsIds.push(this.metaWindow.connect('notify::title', this.protect(w => this.refreshTitle(w.title))));
        this.windowSwitchOptions = {forward: {sc: 0.5, dx: -300, dy: 0}, backwards: {sc: 0.5, dx: -300, dy: 0}};
        this.idle = false;
        this.hovered = false;
        this.clicked = false;
        this.activated = false;
        this.isFocusClone = false;
        this.hyperviewRetained = false;
        this.activeWindowValue = 0;
        this.focusInhibition = false;
    }

    refreshClone(withTransients) {
        if (this.clone)
        {
            this.actor.remove_child(this.clone);
            this.clone.destroy();
        }
        this.clone = new Clutter.Group({ reactive: false, name: "clone group" });
        let [pwidth, pheight] = [this.realWindow.width, this.realWindow.height];
        let clones = WindowUtils.createWindowClone(this.metaWindow, 0, 0, withTransients === true); //first window in this array is the only one that's not a transient
        for (let i = 0; i < clones.length; i++) {
            let clone = clones[i].actor;
            this.clone.add_actor(clone);
            let [width, height] = clone.get_size();
            clone.set_position(Math.round((pwidth - width) / 2), Math.round((pheight - height) / 2));
        }
        this.actor.add_actor(this.clone);
        this.refreshTitle();
    }

    destroy()
    {
        this.connectionIds.forEach((id)=>this.actor.disconnect(id));
        this.metaWindowConnectionsIds.forEach((id)=>this.metaWindow.disconnect(id));
        this.realActorConnectionIds.forEach((id)=>this.realWindow.disconnect(id));
        this.title.destroy();
        this.caption.destroy();
        this.connectionIds = Array();
        this.realActorConnectionIds = Array();
        this.hoverProgress.destroy();
        this.actor.destroy();
        this.releaseHyperview();
    }

    getActor()
    {
        return this.actor;
    }

    getTitleActor()
    {
        return this.caption;
    }

    onDestPosTick(value)
    {
        this.setDirty();
    }

    // ---- change handlers ----
    onPositionChanged() {
        let geom = new Meta.Rectangle();
        this.minimizedLocation = {};
        let actor = this.realWindow;
        if (this.metaWindow.get_icon_geometry(geom))
        {
            this.minimizedLocation.x = geom.x+(geom.width/2)-(actor.width/2);
            this.minimizedLocation.y = geom.y+(geom.height/2)-(actor.height/2);
            this.minimizedScale = ((geom.width / actor.width)<(geom.height / actor.height))?(geom.width / actor.width):(geom.height / actor.height);
        }
        else
        {
            this.minimizedLocation.x = Main.layoutManager.primaryMonitor.width/2-(this.realWindow.width/2);
            this.minimizedLocation.y = Main.layoutManager.primaryMonitor.height-(this.realWindow.height/2);
            this.minimizedScale = 0.1;
        }
        this.windowLocation = {x: actor.x, y: actor.y};
        this.setDirty();
    }

    onSizeChanged()
    {
        //this.actor.set_size(this.realWindow.width, this.realWindow.height);
        this.refreshDestinationVariables();
    }
    // ---- end of change handlers ----

    // ---- Window overview destination setters ----
    setDestination(x, y, destMaxScaleX, destMaxScaleY)
    {
        this.thumbnailLocation = {x: x, y: y};
        this.destMaxScaleX = destMaxScaleX;
        this.destMaxScaleY = destMaxScaleY;

        this.setDirty();
        this.refreshDestinationVariables();
    }
    // ---- End of window overview destination setters ----

    refreshDestinationVariables()
    {
        this.destPosXProgress.setTarget(this.thumbnailLocation.x-(this.realWindow.width/2));
        this.destPosYProgress.setTarget(this.thumbnailLocation.y-(this.realWindow.height/2));
        let ratio1 = this.destMaxScaleX*Main.layoutManager.primaryMonitor.width/this.realWindow.width;
        let ratio2 = this.destMaxScaleY*Main.layoutManager.primaryMonitor.height/this.realWindow.height;
        let old_destScale = this.destScale;
        this.destScale = (ratio1 < ratio2)?ratio1:ratio2;
        if(this.destScale > 1)this.destScale = 1;
        if(old_destScale !== this.destScale)
        {
            this.setDirty();
            this.refreshTitle();
        }
    }

    onClean()
    {
        this.dirty = false;
        let w_pr = this.hyperWorkspace.windowTickerSelfUnitProgress;
        let h_pr = this.hoverProgress.unit_progress;
        let m_pr = this.minimizerProgress.unit_progress;
        if(this.idle)
        {
            if(this.hyperWorkspace.maximizedAppExists && (w_pr > 0))this.actor.set_opacity(0);
            else this.actor.set_opacity((1-w_pr)*(1-w_pr)*(1-w_pr)*255);
        }
        else
        {
            if((m_pr > 0) && (w_pr === 0))
            {
                // WINDOW IS MINIMIZING
                let sc = interpolate(1, this.minimizedScale, clamp(1-(1-1.1*m_pr)*(1-1.1*m_pr), 0, 1));
                this.actor.set_scale(sc, sc);
                this.actor.set_position(interpolate(this.windowLocation.x, this.minimizedLocation.x, m_pr), interpolate(this.windowLocation.y, this.minimizedLocation.y, m_pr*m_pr));
                this.actor.set_opacity(clamp(255*(1-1.1*m_pr*m_pr), 0, 255));
            }
            else
            {
                // NORMAL CASE
                let rotdirN = (this.activeWindowValue>0);
                let rotopt = rotdirN?this.windowSwitchOptions.forward:this.windowSwitchOptions.backwards;
                let rotadv = Math.sin(Math.PI*(this.activeWindowValue/1000000));
                let sc = interpolate(interpolate(this.metaWindow.minimized?this.minimizedScale:1, rotopt.sc, rotadv*rotadv), this.destScale, w_pr)*(1+w_pr*ADDED_RATIO_HOVER*h_pr);
                this.actor.set_scale(sc, sc);
                this.actor.set_position(interpolate(this.metaWindow.minimized?this.minimizedLocation.x:this.windowLocation.x, this.destPosXProgress.progress, w_pr)+rotadv*rotopt.dx, interpolate(this.metaWindow.minimized?this.minimizedLocation.y:this.windowLocation.y, this.destPosYProgress.progress, w_pr)+rotadv*rotopt.dy);
                this.caption.set_position(this.destPosXProgress.progress+(this.realWindow.width/2)-this.caption.width/2, this.destPosYProgress.progress+(this.realWindow.height/2)*(1+sc));
                if(this.metaWindow.minimized)this.actor.set_opacity(w_pr*255);
                else this.actor.set_opacity(255);
            }
        }
        return false;
    }

    setIdle(value)
    {
        this.idle = value;
        if(value)
        {
            this.actor.set_scale(1, 1);
            this.actor.set_position(this.windowLocation.x, this.windowLocation.y);
        }
    }

    motionEvent(actor, event)
    {
        if(this.idle)return false;
        this.hovered = true;
        this.hoverProgress.setTarget(1000000);
        //this.hyperWorkspace.motionEvent();
        return false;
    }

    leaveEvent(actor, event)
    {
        if(this.idle)return false;
        this.hovered = false;
        this.hoverProgress.setTarget(0);
        this.clicked = false;
        return false;
    }

    buttonPressEvent(actor, event)
    {
        if(this.idle)return false;
        this.hyperWorkspace.motionEvent();
        this.hovered = true;
        if(event.get_button() === 1)
        {
            this.clicked = true;
            return true;
        }
        else if(event.get_button() === 2)
        {
            if(this.hyperview.workspaceOverviewEnabled && (global.screen.get_n_workspaces() > 1))
            {
                return false;
            }
            else
            {
                this.clicked = true;
                return true;
            }
        }
        return false;
    }

    buttonReleaseEvent(actor, event) //Hyperwindow
    {
        if(this.idle)return false;
        let o_clicked = this.clicked;
        this.clicked = false;
        if(this.hovered && o_clicked)
        {
            if(event.get_button() === 1)
            {
                this.hoverProgress.setTarget(0);
                this.activated = true;
                this.onPositionChanged();
                this.hyperview.activateClone(this);
                return true;
            }
            else if(event.get_button() === 2)
            {
                if(this.hyperview.workspaceOverviewEnabled && (global.screen.get_n_workspaces() > 1))
                {
                    return false;
                }
                else
                {
                    this.hoverProgress.setTarget(0);
                    if(this.metaWindow.get_maximized()===3)this.hyperview.notifyWindowWasMaximized(this.metaWindow.get_stable_sequence().toString());
                    this.metaWindow.delete(global.get_current_time());
                    return true;
                }
            }
        }
        return false;
    }

    onHoverTick(o_p, n_p)
    {
        this.setDirty();
    }

    setIsFocusClone(value)
    {
        this.isFocusClone = value;
        this.minimizerProgress.options.slope = ((this.isFocusClone && this.hyperview.isFineControlled)?SLOPE_CONTROLLED:SLOPE_NOT_CONTROLLED)*MINIMIZING_WINDOW_SLOPE_FACTOR;
    }

    refreshTitle(titleText)
    {
        this.title.text = titleText||this.metaWindow.title;
        let [minW, preferred] = this.caption.get_preferred_width(-1);
        this.caption.width = Math.min(this.realWindow.width*this.destScale, preferred);
        this.setDirty();
    }

    refreshHovered()
    {
        if(this.idle)return;
        if(!this.actor.has_pointer && this.hovered)
        {
            this.leaveEvent();
        }
        else if(this.actor.has_pointer && !this.hovered)
        {
            this.motionEvent();
        }
    }

    setDirty()
    {
        if(this.dirty)return;
        this.dirty = true;
        mngr.engine.registerDirty(2, this);
    }

    onMinimizerTick(n_p, o_p)
    {
        this.setDirty();
        if(this.minimizerProgress.onGoal())
        {
            this.focusInhibition = false;
            this.releaseHyperview();
        }
    }

    setActiveWindowValue(value)
    {
        if(value !== this.activeWindowValue)this.setDirty();
        this.activeWindowValue = value;
    }

    minimize()
    {
        if(!this.metaWindow.can_minimize())return;
        if(this.minimizerProgress.progress !== 1000000)this.focusInhibition = true;
        this.setMinimizerTarget(1000000);
        this.metaWindow.minimize();
        this.onPositionChanged();
    }

    setMinimizerTarget(value)
    {
        if(!this.metaWindow.can_minimize())return;
        this.minimizerProgress.setTarget(value)
    }

    onMinimizerPauseChange()
    {
        if(!this.minimizerProgress.paused) this.retainHyperview();
        else if(this.minimizerProgress.onGoal()) this.releaseHyperview();
    }

    releaseHyperview()
    {
        if(this.hyperviewRetained)
        {
            this.hyperview.waitingMinimizing--;
            this.hyperviewRetained = false;
            this.hyperview.notifyWaitingWindowCountChanged();
        }
    }

    retainHyperview()
    {
        if(!this.hyperviewRetained)
        {
            this.hyperview.waitingMinimizing++;
            this.hyperviewRetained = true;
            this.hyperview.notifyWaitingWindowCountChanged();
        }
    }
};

class HyperviewWorkspace {
    // group
    // +--- overlay
    // +--- clones
    // +--- titles
    // +--- idleClones
    // +--- backgroundGroup
    //      +--- background
    //      +--- gradient
    //      +--- noWinLabel

    constructor(metaWorkspace, hyperview)
    {
        this.metaWorkspace = metaWorkspace;
        this.hyperview = hyperview;
        this.loaded = false;
        this.clones = {};
        this.dirty = 0;
        this.idleClones = {};
        this.maximizedAppExists = false;
        this.inFullscreen = false;
        this.stableIndex = hyperWorkspacesStableSequence.toString();
        hyperWorkspacesStableSequence++;
        this.workspaceHoverProgress = new Progress({slope: SLOPE_NOT_CONTROLLED, callback: this.onHoverTick.bind(this), stickAroundTarget: 90, stickAroundGoals: 90, goals: [0,1000000], max: 1000000, min: 0});
        this.destPosXProgress = new Progress({defaultToUndefined: true, float: true, slope: SLOPE_NOT_CONTROLLED, callback: this.onDestValuesTick.bind(this), stickAroundTarget: 1});
        this.destPosYProgress = new Progress({defaultToUndefined: true, float: true, slope: SLOPE_NOT_CONTROLLED, callback: this.onDestValuesTick.bind(this), stickAroundTarget: 1});
        this.destScaleProgress = new Progress({defaultToUndefined: true, float: true, slope: SLOPE_NOT_CONTROLLED, callback: this.onDestValuesTick.bind(this), stickAroundTarget: 0.01});
        this.windowTickerSelfUnitProgress = interpolate(this.hyperview.windowTicker.unit_progress, 1, this.hyperview.workspaceOverviewTicker.unit_progress);
        this.preventNoWinLabel = false;
        let primary = Main.layoutManager.primaryMonitor;
        this.gridPosition = undefined;

        this.views = {};
        this.windowSwitchHappened = false;
        
        let group = new Clutter.Actor({ reactive: true, name: "HyperWorkspace " + this.stableIndex });
        group.set_size(primary.width, primary.height);
        group._delegate = this;
        group.set_pivot_point(0.5, 0.5);
        group.hide();
        this.views.group = group;

        let backgroundGroup = new Clutter.Actor({reactive: false, name:"background"});
        group.add_actor(backgroundGroup);
        backgroundGroup.set_size(primary.width, primary.height);
        backgroundGroup.set_position(0, 0);
        this.views.backgroundGroup = backgroundGroup;

        let cloneGroup = new Clutter.Actor({reactive: false, name: "clone group"});
        group.add_actor(cloneGroup);
        cloneGroup.set_size(primary.width, primary.height);
        cloneGroup.set_position(0, 0);
        this.views.cloneGroup = cloneGroup;

        let titleGroup = new Clutter.Actor({reactive: false, name: "title group"});
        group.add_actor(titleGroup);
        titleGroup.set_size(primary.width, primary.height);
        titleGroup.set_position(0, 0);
        this.views.titleGroup = titleGroup;

        let idleCloneGroup = new Clutter.Actor({reactive: false, name: "idleclone group"});
        group.add_actor(idleCloneGroup);
        idleCloneGroup.set_size(primary.width, primary.height);
        idleCloneGroup.set_position(0, 0);
        this.views.idleCloneGroup = idleCloneGroup;

        let overlay = new Clutter.Actor({reactive: false, name: "overlay group"});
        group.add_actor(overlay);
        overlay.set_size(primary.width, primary.height);
        overlay.set_position(0, 0);
        this.views.overlay = overlay;

        group.set_child_below_sibling(backgroundGroup, null);
        group.set_child_above_sibling(idleCloneGroup, backgroundGroup);
        group.set_child_above_sibling(titleGroup, idleCloneGroup);
        group.set_child_above_sibling(cloneGroup, titleGroup);
        group.set_child_above_sibling(overlay, cloneGroup);

        let background = Meta.BackgroundActor.new_for_screen(global.screen);
        background.set_position(0, 0);
        backgroundGroup.add_actor(background);
        background.set_pivot_point(0.5, 0.5);
        this.views.background = background;
        
        let gradient = new Clutter.Rectangle({ opacity: 0, reactive: true, name: "gradient"});
        gradient.set_color(Clutter.Color.get_static(Clutter.StaticColor.BLACK));
        backgroundGroup.add_actor(gradient);
        this.groupConnectionIds = [];
        this.groupConnectionIds.push(group.connect('motion-event', this.protect(this.motionEvent)));
        this.groupConnectionIds.push(group.connect('leave-event', this.protect(this.leaveEvent)));
        this.groupConnectionIds.push(group.connect('button-press-event', this.protect(this.buttonPressEvent)));
        this.groupConnectionIds.push(group.connect('button-release-event', this.protect(this.buttonReleaseEvent)));
        gradient.set_position(0, 0);
        gradient.set_size(primary.width, primary.height);
        this.views.gradient = gradient;
        
        let noWinLabel = new St.Label({ style_class: 'workspace-osd', text: _('No open windows'), name: "no window label" }); //todo find the right theme
        noWinLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        noWinLabel._spacing = 0;
        noWinLabel.add_constraint_with_name("centered", new Clutter.AlignConstraint({source: background, align_axis: Clutter.AlignAxis.BOTH, factor: 0.5}));
        noWinLabel.set_opacity(0);
        backgroundGroup.add_actor(noWinLabel);
        this.views.noWinLabel = noWinLabel;
        
        backgroundGroup.set_child_below_sibling(background, null);
        backgroundGroup.set_child_above_sibling(gradient, background);
        backgroundGroup.set_child_above_sibling(noWinLabel, gradient);
        
        this.idsToDisconnect = [this.metaWorkspace.connect('window-added', this.protect(this.onWindowAdded)), this.metaWorkspace.connect('window-removed', this.protect(this.onWindowRemoved))]

        this.hyperview.hyperstage.add_actor(group);
        this.hyperview.hyperstage.set_child_above_sibling(group, null);
        group.set_position(0, 0);
        group.show();
        this.hovered = false;
        this.clicked = false;
    }

    unload()
    {
        if(!this.loaded)return;
        Object.values(this.idleClones).forEach(x=>x.destroy());
        Object.values(this.clones).forEach(x=>x.destroy());
        this.idleClones = {};
        this.clones = {};
        this.sortedClones = [];
        this.maximizedAppExists = false;
        this.loaded = false;
    }

    destroy()
    {
        this.unload();
        this.idsToDisconnect.forEach((x)=>this.metaWorkspace.disconnect(x));
        this.idsToDisconnect = [];
        this.dirty = 0;
        let {group, noWinLabel, backgroundGroup} = this.views;
        this.groupConnectionIds.forEach(x=>group.disconnect(x));
        this.groupConnectionIds = [];
        this.hyperview.hyperstage.remove_child(group);
        noWinLabel.remove_constraint_by_name("centered");
        backgroundGroup.remove_all_children();
        group.remove_all_children();
        Object.values(this.views).forEach((x)=>x.destroy());
        this.views = {};
        this.workspaceHoverProgress.destroy();
        this.destPosXProgress.destroy();
        this.destPosYProgress.destroy();
        this.destScaleProgress.destroy();
    }

    load()
    {
        if(this.loaded)return this;
        this.currentActiveClone = 0;
        let primary = Main.layoutManager.primaryMonitor;
        this.views.group.set_position(this.metaWorkspace.index()*(primary.width+MARGIN_BETWEEN_WORKSPACES) - this.hyperview.workspaceSwitchTicker.progress*(primary.width+MARGIN_BETWEEN_WORKSPACES)/1000000, 0);
        this.syncClones()
        this.setDirty(DIRT_TYPE.WINDOW)
        this.loaded = true;
        return this;
    }

    deleteCloneById(cid)
    {
        if(cid in this.clones)
        {
            this.views.cloneGroup.remove_child(this.clones[cid].getActor());
            this.views.titleGroup.remove_child(this.clones[cid].getTitleActor());
            this.clones[cid].destroy();
            this.clones[cid] = undefined;
            delete this.clones[cid];
        }
        else if(cid in this.idleClones)
        {
            this.views.idleCloneGroup.remove_child(this.idleClones[cid].getActor());
            this.idleClones[cid].destroy();
            this.idleClones[cid] = undefined;
            delete this.idleClones[cid];
        }
    }

    shouldIncludeWindow (window)
    {
        return Main.isWindowActorDisplayedOnWorkspace(window, this.metaWorkspace.index()) && (!window.get_meta_window() || window.get_meta_window().get_monitor() == Main.layoutManager.primaryMonitor.index);
    }
    
    syncClones()
    {
        this.maximizedAppExists = false;
        global.get_window_actors().filter(this.shouldIncludeWindow.bind(this)).forEach(this.addCloneIfNotExist.bind(this));
        this.setWindowsDestinationPositions();
    }
    
    addCloneIfNotExist(win)
    {
        let metaWin = win.get_meta_window();
        let interesting = Main.isInteresting(metaWin);
        var id = metaWin.get_stable_sequence().toString();
        if((interesting?this.clones:this.idleClones)[id] === undefined)
        {
            let new_clone = new HyperviewWindow(this, win);
            (interesting?this.clones:this.idleClones)[id] = new_clone;
            new_clone.setIdle(!interesting);
            if(interesting)
            {
                this.views.cloneGroup.add_actor(new_clone.getActor());
                this.views.titleGroup.add_actor(new_clone.getTitleActor());
            }
            else
            {
                this.views.idleCloneGroup.add_actor(new_clone.getActor());
            }
        }
        else (interesting?this.clones:this.idleClones)[id].refreshClone(true);
        if(interesting)
        {
            if((metaWin.get_maximized() === 3)&&(!metaWin.minimized))this.maximizedAppExists = true;
        }
    }
    
    setWindowsDestinationPositions() // Form workspace.js
    {
        let clones = Object.values(this.clones);
        clones.sort(this.sortWindowsByUserTime.bind(this));
        this.sortedClones = clones;
        let numberOfWindows = clones.length;
        let gridWidth = Math.ceil(Math.sqrt(numberOfWindows));
        let gridHeight = Math.ceil(numberOfWindows / gridWidth);
        let fractionX = DEFAULT_SLOT_FRACTION * (1. / gridWidth);
        let fractionY = DEFAULT_SLOT_FRACTION * (1. / gridHeight);
        let primary = Main.layoutManager.primaryMonitor;
        clones.forEach((clone, i)=>{
            let scaleX = fractionX;
            let scaleY = fractionY;
            
            let xCenter = (.5 / gridWidth) + ((i) % gridWidth) / gridWidth;
            if(i>=(gridHeight-1)*gridWidth)xCenter+=((gridHeight*gridWidth-numberOfWindows)/2)/gridWidth;
            let yCenter = (.5 / gridHeight) + Math.floor((i / gridWidth)) / gridHeight;
            
            clone.setDestination(Math.round(xCenter*primary.width), Math.round(yCenter*primary.height), scaleX, scaleY);
        });
        Object.values(this.clones).forEach(v=>v.onClean());
        Object.values(this.idleClones).forEach(v=>v.onClean());
    }

    sortWindowsByUserTime(clone1, clone2) { //From appSwitcher.js
        let win1 = clone1.metaWindow;
        let win2 = clone2.metaWindow;
        
        let t1 = win1.get_user_time();
        let t2 = win2.get_user_time();
    
        let m1 = win1.minimized;
        let m2 = win2.minimized;

        if (m1 == m2) return (t2 > t1) ? 1 : -1;
        else return m1 ? 1 : -1;
    }

    onWindowAdded(metaWorkspace, metaWin)
    {
        if(metaWin.get_compositor_private())this.addCloneIfNotExist(metaWin.get_compositor_private());
        else this.hyperview.registerIncubatingWindows(metaWin, this);
    }

    onWindowRemoved(metaWorkspace, metaWin)
    {
        let maximized = false;
        if(metaWin.get_stable_sequence().toString() in this.hyperview.toldMaximizedWindow)
        {
            maximized = true;
            delete this.hyperview.toldMaximizedWindow[metaWin.get_stable_sequence().toString()];
        }
        let needRecheck = ((!metaWin.minimized)&&(maximized||(metaWin.get_maximized() === 3)));
        this.deleteCloneById(metaWin.get_stable_sequence().toString());
        this.setWindowsDestinationPositions();
        if(needRecheck)
        {
            this.maximizedAppExists = false;
            let wins = Object.values(this.clones);
            for(let i = 0; i < wins.length; i++)
            {
                let mw = wins[i].metaWindow;
                if((!mw.minimized)&&(mw.get_maximized() === 3))
                {
                    this.maximizedAppExists = true;
                    break;
                }
            }
        }
        if((Object.keys(this.clones).length === 0))
        {
            this.preventNoWinLabel = true;
            this.hyperview.setWindowTarget(0, "down");
        }
    }

    setDestinationPosition(x,y)
    {
        this.destPosXProgress.setTarget(x);
        this.destPosYProgress.setTarget(y);
        this.onDestValuesTick();
    }

    setDestinationScale(sc)
    {
        this.destScaleProgress.setTarget(sc);
        this.onDestValuesTick();
    }

    setGridPosition(i, j)
    {
        this.gridPosition = {i: i, j: j};
    }
    
    activateClone(_clone)
    {
        this.views.cloneGroup.set_child_above_sibling(_clone.getActor(), null);
        Object.values(this.clones).forEach((clone)=>{
            if(clone.metaWindow.is_always_on_top())this.views.cloneGroup.set_child_above_sibling(clone.getActor(), null);
        })
        if(_clone.metaWindow.is_always_on_top())this.views.cloneGroup.set_child_above_sibling(_clone.getActor(), null);
        if(global.screen.get_active_workspace_index() !== this.metaWorkspace.index())mngr.preventNextDefaultWorkspaceEffect = true;
        Main.activateWindow(_clone.metaWindow);
    }

    computeAnimationForClone(cloneIndex, otherCloneIndex, direction)
    {
        // TODO
    }

    onClean() //Hyperworkspaces
    {
        if(this.dirty === 0)return false; //Maybe we got destroyed in the meantime
        let dirt = this.dirty;
        this.dirty = 0;
        let currentHyperWorkspace = this.hyperview.hyperWorkspaces[global.screen.get_active_workspace_index()];
        if((dirt & (DIRT_TYPE.SELF_POSITION | DIRT_TYPE.WORKSPACE_OVERVIEW | DIRT_TYPE.WORKSPACE_SWITCH | DIRT_TYPE.HOVER))) // Only whole position and set is managed there
        {
            let y_progress = this.hyperview.workspaceOverviewTicker.progress;
            let y_pr = this.hyperview.workspaceOverviewTicker.unit_progress;
            let h_pr = this.workspaceHoverProgress.unit_progress;
            let current = this.hyperview.currentWorkspaceIndex;
            let workspaceTotalWidth = (Main.layoutManager.primaryMonitor.width+MARGIN_BETWEEN_WORKSPACES)
            let release_x = workspaceTotalWidth*current;
            let i = this.metaWorkspace.index();
            let destX = this.destPosXProgress.progress;
            let destY = this.destPosYProgress.progress;
            let destScale = this.destScaleProgress.progress;
            // [0:100000] normal animation
            // [100000:200000] flee
            // [200000:1000000] normal animation
            let shouldFlee = (Math.abs(i-current) === 1) && (currentHyperWorkspace.gridPosition.i !== this.gridPosition.i);
            if(y_progress < 100000)
            {
                if(current === i)this.views.group.set_position(interpolate(i*workspaceTotalWidth - interpolate(this.hyperview.lx_p, release_x, clamp(10*y_pr,0,1)), destX, y_pr), destY*y_pr);
                else this.views.group.set_position(i*workspaceTotalWidth - interpolate(this.hyperview.lx_p, release_x, clamp(10*y_pr,0,1)), destY*y_pr);
            }
            else if(y_progress > 200000 || (!shouldFlee))
            {
                // NORMAL
                let x = (destX - currentHyperWorkspace.destPosXProgress.progress)/destScale;
                let y = (destY - currentHyperWorkspace.destPosYProgress.progress)/destScale;
                this.views.group.set_position(interpolate(current*workspaceTotalWidth+x - interpolate(this.hyperview.lx_p, release_x, clamp(10*y_pr,0,1)), destX, y_pr), interpolate(y, destY, y_pr));
            } 
            else if(y_progress >= 150000)
            {
                let x = (destX - currentHyperWorkspace.destPosXProgress.progress)/destScale;
                let y = (destY - currentHyperWorkspace.destPosYProgress.progress)/destScale;
                this.views.group.set_position(interpolate(current*workspaceTotalWidth + x - release_x, destX, 0.1+2*(y_pr-0.15)), interpolate(y, destY, 0.1+2*(y_pr-0.15)));
            }
            else
            {
                this.views.group.set_position(i*workspaceTotalWidth - interpolate(this.hyperview.lx_p, release_x, clamp(10*y_pr,0,1)), destY*y_pr);
            }
            let sc = interpolate(1, destScale, y_pr)*(1+ADDED_RATIO_HOVER_WORKSPACE*h_pr);
            this.views.group.set_scale(sc, sc);
        }
        if(dirt & (DIRT_TYPE.WORKSPACE_OVERVIEW | DIRT_TYPE.WINDOW | DIRT_TYPE.HOVER)) //Hyperworkspace internal elements placement
        {
            this.windowTickerSelfUnitProgress = interpolate(this.hyperview.windowTicker.unit_progress, 1, this.hyperview.workspaceOverviewTicker.unit_progress);
            let pr = this.windowTickerSelfUnitProgress;
            Object.values(this.clones).forEach((x)=>x.setDirty());
            Object.values(this.idleClones).forEach((x)=>x.setDirty());
            this.views.gradient.set_opacity(interpolate(0, 128, pr));
            this.views.titleGroup.set_opacity(255*Math.max(0, pr*20-19));
            
            //this.views.background.set_scale(interpolate(1, 0.9, pr), interpolate(1, 0.9, pr));
            //global.log(this.stableIndex, Object.values(this.clones).length)
            if(this.hyperview.windowTicker.progress > this.hyperview.windowTicker.old_progress)this.preventNoWinLabel = false;
            if((Object.values(this.clones).length === 0)&&(!this.preventNoWinLabel))this.views.noWinLabel.set_opacity(pr*255);
            else this.views.noWinLabel.set_opacity(0);
        }
        if(dirt & DIRT_TYPE.ELEMENT_POSITIONS) //windows
        {
            this.setWindowsDestinationPositions();
        }
        if((dirt & DIRT_TYPE.WINDOW_SWITCH) && (this.sortedClones.length > 1))
        {
            let offset = this.hyperview.windowSwitchTicker.decay; //How many windows we switched
            let v = this.hyperview.windowSwitchTicker.progress;
            let modulo = this.sortedClones.length;
            if(offset === 0) // We already have computed animation for current window and the next one
            {
                if(this.sortedClones.length !== 2)
                {
                    this.sortedClones[this.currentActiveClone].setActiveWindowValue(v);
                    this.sortedClones[(this.currentActiveClone+1)%modulo].setActiveWindowValue(clamp(v-1000000, -1000000, 1000000));
                    this.sortedClones[(this.currentActiveClone+modulo-1)%modulo].setActiveWindowValue(clamp(v+1000000, -1000000, 1000000));
                }
                else
                {
                    this.sortedClones[this.currentActiveClone].setActiveWindowValue(v);
                    this.sortedClones[1-this.currentActiveClone].setActiveWindowValue((v-1000000)%2000000);
                }
            }
            else
            {
                this.windowSwitchHappened = true;
                let nextActiveClone = (this.currentActiveClone + offset)%modulo;
                if(nextActiveClone < 0)nextActiveClone += modulo;
                this.currentActiveClone = nextActiveClone;
                if(offset > 0)
                {
                    this.computeAnimationForClone(this.currentActiveClone, (this.currentActiveClone+1)%modulo, ANIMATION_DIRECTION.FORWARD); //We moved forward, so get the next one ready
                }
                else if(offset < 0)
                {
                    this.computeAnimationForClone(this.currentActiveClone, (this.currentActiveClone+modulo-1)%modulo, ANIMATION_DIRECTION.BACKWARDS); //We moved backwards, so get the previous one ready
                }
                if(v>=0) this.views.cloneGroup.set_child_above_sibling(this.sortedClones[(this.currentActiveClone+1)%modulo].getActor() ,null);
                else this.views.cloneGroup.set_child_above_sibling(this.sortedClones[(this.currentActiveClone+modulo-1)%modulo].getActor() ,null);
                this.views.cloneGroup.set_child_above_sibling(this.sortedClones[this.currentActiveClone].getActor() ,null);
                if(Math.abs(offset) === 1)
                {
                    this.sortedClones[(this.currentActiveClone+2)%modulo].setActiveWindowValue(0);
                    this.sortedClones[(this.currentActiveClone+modulo-2)%modulo].setActiveWindowValue(0);
                }
                else this.sortedClones.forEach((x)=>x.setActiveWindowValue(0));
                this.sortedClones[this.currentActiveClone].setActiveWindowValue(v);
                this.sortedClones[(this.currentActiveClone+1)%modulo].setActiveWindowValue(clamp(v-1000000, -1000000, 1000000));
                this.sortedClones[(this.currentActiveClone+modulo-1)%modulo].setActiveWindowValue(clamp(v+1000000, -1000000, 1000000));
            }
        }
        return (this.dirty !== 0);
    }

    setDirty(dirtyMask)
    {
        if((this.dirty|dirtyMask) === this.dirty)return;
        let o = (this.dirty === 0)&&(dirtyMask !== 0);
        this.dirty |= dirtyMask;
        if(o)mngr.engine.registerDirty(1, this);
    }

    performWindowSwitch()
    {
        if(this.windowSwitchHappened)this.activateClone(this.sortedClones[this.currentActiveClone]);
    }

    resetWindowSwitchOrder()
    {
        if(!this.windowSwitchHappened)return;
        this.sortedClones.filter(x=>x.metaWindow.is_always_on_top()).forEach(x=>this.views.cloneGroup.set_child_below_sibling(x.getActor() ,null));
        this.sortedClones.filter(x=>!x.metaWindow.is_always_on_top()).forEach(x=>this.views.cloneGroup.set_child_below_sibling(x.getActor() ,null));
    }

    onWorkspaceOverviewEnabled()
    {
        this.hovered = false;
        this.clicked = false;
    }

    onWorkspaceOverviewDisabled()
    {
        this.hovered = false;
        this.clicked = false;
        this.renewWorkspaceHoverTarget();
    }

    motionEvent()
    {
        this.hovered = true;
        this.renewWorkspaceHoverTarget();
        return true;
    }

    leaveEvent()
    {
        this.hovered = false;
        this.clicked = false;
        this.renewWorkspaceHoverTarget();
        return true;
    }

    buttonPressEvent(actor, event)
    {
        this.hovered = true;
        this.clicked = true;
        this.renewWorkspaceHoverTarget();
        return true;
    }

    buttonReleaseEvent(actor, event) //Hyperworkspace
    {
        if(this.hovered && this.clicked)
        {
            if(event.get_button() === 1)
            {
                this.renewWorkspaceHoverTarget();
                this.hyperview.onWorkspaceClicked(this);
            }
            else if(event.get_button() === 2) // middle-click
            {
                if((global.screen.get_n_workspaces() > 1) && this.hyperview.workspaceOverviewEnabled) //did that mistake once, not twice
                {
                    this.renewWorkspaceHoverTarget();
                    this.hyperview.removeWorkspace(this);
                }
            }
        }
        this.clicked = false;
        return true;
    }

    renewWorkspaceHoverTarget()
    {
        if(!this.hovered)this.workspaceHoverProgress.setTarget(0);
        else if(!this.hyperview.workspaceOverviewEnabled)this.workspaceHoverProgress.setTarget(0);
        else if(this.clicked)this.workspaceHoverProgress.setTarget(0);
        else if(global.screen.get_n_workspaces() === 1)this.workspaceHoverProgress.setTarget(0);
        else this.workspaceHoverProgress.setTarget(1000000);
    }

    onHoverTick(n_p, o_p)
    {
        this.setDirty(DIRT_TYPE.HOVER);
    }

    onDestValuesTick(value)
    {
        this.setDirty(DIRT_TYPE.SELF_POSITION);
    }

    isEmpty()
    {
        if(!this.loaded)return false; //shouldn't happen
        return (Object.values(this.clones).length === 0);
    }
}

class Hyperview {
    constructor()
    {
        this.started = false;
        this.windowLockPosition = "down";
        this.workspaceOverviewLockPosition = "down";
        this.isFineControlled = false;
        this.panelsEnabled = true;
        this.focusClone = undefined;
        this.hyperstage = null;
        this.toldMaximizedWindow = {};
        this.metaWorkspaces = [];
        this.hyperWorkspaces = [];
        this.dirty = 0;
        this.views = {};
        this.allWorkspaceLoad = false;
        this.loadWorkspaceThreshold = undefined;
        this.shouldWindowSwitch = false;
        this.workspaceOverviewEnabled = false;

        let goals = [];
        for(let i = 0; i < global.screen.get_n_workspaces(); i++)goals.push(i*1000000);

        this.buildWorkspaceMap();
        this.currentWorkspaceIndex = global.screen.get_active_workspace_index();
        this.workspaceChangedId = global.window_manager.connect('switch-workspace', this.protect(this.onWorkspaceChanged));
        this.windowTicker = new Progress({slope: SLOPE_CONTROLLED, callback: this.onWindowTick.bind(this), stickAroundTarget: 90, stickAroundGoals: 90, goals: [0, 1000000], max: 1000000, min: 0});
        this.workspaceSwitchTicker = new Progress({slope: SLOPE_CONTROLLED*SWITCH_CONTROLLED_SLOPE_FACTOR, callback: this.onWorkspaceSwitchTick.bind(this), stickAroundTarget: 3, stickAroundGoals: 3, goals: goals});
        this.windowSwitchTicker = new ModularProgress({slope: SLOPE_CONTROLLED*SWITCH_CONTROLLED_SLOPE_FACTOR, callback: this.onWindowSwitchTick.bind(this), stickAroundTarget: 90});
        this.workspaceOverviewTicker = new Progress({slope: SLOPE_CONTROLLED, callback: this.onWorkspaceOverviewTick.bind(this), stickAroundTarget: 90, stickAroundGoals: 90, goals: [0,1000000], min: 0, max: 1000000});
        this.workspaceSwitchTicker.jumpTo(this.currentWorkspaceIndex*1000000);
    }
    
    start(controlled)
    {
        if(this.started)return;
        this.windowLockPosition = "down";
        this.workspaceOverviewLockPosition = "down";
        this.workspaceClicked = false;
        this.workspaceOverviewEnabled = false;
        let primary = Main.layoutManager.primaryMonitor;
        this.toldMaximizedWindow = {};
        this.workspaceSwitchDirection = "still";
        this.waitingMinimizing = 0;
        this.hyperstage = new Clutter.Actor({ reactive: true, name: "Hyperview" });
        this.views = {};
        this.incubatingWindows = [];
        this.views.background = Meta.BackgroundActor.new_for_screen(global.screen);
        this.hyperstage.add_actor(this.views.background);
        this.views.gradient = new Clutter.Rectangle({ opacity: 0, reactive: false, name: "gradient" });
        this.views.gradient.set_color(Clutter.Color.get_static(Clutter.StaticColor.BLACK));
        this.views.gradient.set_opacity(255);
        this.views.gradient.connect('event', ((actor, event) => false));
        this.views.gradient.set_position(0, 0);
        this.views.gradient.set_size(primary.width, primary.height);

        this.hyperstage.add_actor(this.views.gradient);
        this.hyperstage.set_child_above_sibling(this.views.gradient, this.views.background);

        this.lx_p = (primary.width+MARGIN_BETWEEN_WORKSPACES)*clamplog(this.workspaceSwitchTicker.progress, 0, (global.screen.get_n_workspaces()-1)*1000000, 1000000/70)/1000000;

        this.started = true;

        this.refreshWorkspaces(); //shouldn't get called everytime
        this.createWorkspaces();
        this.computeWorkspaceDestinations();
        
        this.allWorkspaceLoad = false;
        this.loadWorkspaceThreshold = undefined;

        this.loadWorkspace(global.screen.get_active_workspace_index());
        this.panelsEnabled = true;
        this.focusClone = undefined;

        this.hyperstageConnections = [this.hyperstage.connect('key-press-event', this.protect(this.onKeyPress)), this.hyperstage.connect('key-release-event', this.protect(this.onKeyRelease))];

        this.hyperstage.show();
        global.overlay_group.add_actor(this.hyperstage);
        if(mngr.config.debugMode)
        {
            this.debugSquare = new Clutter.Rectangle({ opacity: 255, reactive: false, name: "debug"});
            this.debugSquare.set_color(Clutter.Color.get_static(Clutter.StaticColor.RED));
            this.debugSquare.set_size(20,20);
            global.overlay_group.add_actor(this.debugSquare);
            global.overlay_group.set_child_above_sibling(this.debugSquare, null)
        }
        else this.debugSquare = undefined;
        this.pushFailed = !Main.pushModal(this.hyperstage);
        global.window_group.hide();
        this.setFineControlled(!!controlled)
        if(this.pushFailed)this.stop();
    }

    stop()
    {
        if(!this.started)return;
        this.allWorkspaceLoad = false;
        this.loadWorkspaceThreshold = undefined;

        //this.windowTicker.setPaused(true);
        
        // Hide
        this.hyperstage.hide();
        if(!this.pushFailed)Main.popModal(this.hyperstage);

        this.hyperstageConnections.forEach((x)=>this.hyperstage.disconnect(x));
        this.hyperstageConnections = [];
        global.window_group.show();

        this.focusClone = undefined;
        this.hyperWorkspaces.forEach((hw)=>hw.destroy());
        
        this.hyperstage.destroy_all_children();
        this.views = {};
        global.overlay_group.remove_child(this.hyperstage);
        if(this.debugSquare !== undefined)
        {
            global.overlay_group.remove_child(this.debugSquare);
            this.debugSquare.destroy()
            this.debugSquare = undefined;
        }
        
        this.enablePanels(true);
        Main.panelManager.setPanelsOpacity(255);
        this.started = false;
    }

    destroy()
    {
        this.stop();
        this.windowTicker.destroy();
        this.windowTicker = null;
        this.workspaceSwitchTicker.destroy();
        this.workspaceSwitchTicker = null;
        this.windowSwitchTicker.destroy();
        this.windowSwitchTicker = null;
        this.workspaceOverviewTicker.destroy();
        this.workspaceOverviewTicker = null;
        global.window_manager.disconnect(this.workspaceChangedId);
    }

    createWorkspaces()
    {
        this.hyperWorkspaces = this.metaWorkspaces.map(x => new HyperviewWorkspace(x, this));
    }

    loadWorkspace(metaWorkspaceIndex)
    {
        this.hyperWorkspaces[metaWorkspaceIndex].load();
    }

    buildWorkspaceMap()
    {
        let metaWorkspaces = []
        let cursor = global.screen.get_workspace_by_index(0)
        let n = global.screen.get_n_workspaces();
        for(let i = 0; i < n; i++)
        {
            metaWorkspaces.push(cursor)
            cursor = cursor.get_neighbor(Meta.MotionDirection.RIGHT);
        }
        this.metaWorkspaces = metaWorkspaces
    }

    refreshWorkspaces()
    {
        this.buildWorkspaceMap();
        this.currentWorkspaceIndex = global.screen.get_active_workspace_index();
        let goals = []
        for(let i = 0; i < global.screen.get_n_workspaces(); i++)
        {
            goals.push(i*1000000);
        }
        this.workspaceSwitchTicker.options.goals = goals;
        this.workspaceSwitchTicker.jumpTo(this.currentWorkspaceIndex*1000000);
    }

    loadNeighborWorkspaces(_metaWorkspace)
    {
        let metaWorkspaceIndex = (_metaWorkspace === undefined)?global.screen.get_active_workspace_index():_metaWorkspace.index();
        for(let i = metaWorkspaceIndex-1; i < metaWorkspaceIndex+2; i++)
        {
            if(i < 0)continue;
            if(i >= global.screen.get_n_workspaces())continue;
            this.hyperWorkspaces[i].load();
        }
    }

    loadOnlyNeighborWorkspaces(_metaWorkspaceIndex)
    {
        let metaWorkspaceIndex = (_metaWorkspaceIndex === undefined)?global.screen.get_active_workspace_index():_metaWorkspaceIndex;
        this.hyperWorkspaces.forEach((hw, index)=>{
            if(Math.abs(index-metaWorkspaceIndex) < 2)hw.load();
            else hw.unload();
        });
    }
    
    loadAllWorkspaces()
    {
        this.hyperWorkspaces.forEach((hw)=>hw.load());
    }

    onWindowTick(new_progress, old_progress)
    {
        this.setDirty(DIRT_TYPE.WINDOW);
    }

    setPanelsOpacity(value)
    {
        Main.panelManager.setPanelsOpacity(value);
    }

    toggleWindow()
    {
        if(this.isFineControlled) return;
        else if(this.windowLockPosition === "up")this.setWindowTarget(0, "down");
        else if(this.windowLockPosition === "down")this.setWindowTarget(1000000, "up");
    }

    toggleWorkspaceOverview()
    {
        if(this.isFineControlled) return;
        else if(this.workspaceOverviewLockPosition === "up")this.setWorkspaceOverviewTarget(0, "down");
        else if(this.workspaceOverviewLockPosition === "down")this.setWorkspaceOverviewTarget(1000000, "up");
    }

    setFineControlled(value)
    {
        this.isFineControlled = value;
        let c_slope = value?SLOPE_CONTROLLED:SLOPE_NOT_CONTROLLED;
        this.windowTicker.options.slope = c_slope;
        if(this.focusClone !== undefined)this.focusClone.minimizerProgress.options.slope = MINIMIZING_WINDOW_SLOPE_FACTOR*c_slope;
        if(!value && ((this.workspaceSwitchTicker.progress < 0) || (this.workspaceSwitchTicker.progress > (global.screen.get_n_workspaces()-1)*1000000)))this.workspaceSwitchTicker.options.slope = SWITCH_OVERDRAFT_SLOPE;
        else if(value) this.workspaceSwitchTicker.options.slope = c_slope*SWITCH_CONTROLLED_SLOPE_FACTOR;
        else this.workspaceSwitchTicker.options.slope = c_slope*SWITCH_NOT_CONTROLLED_SLOPE_FACTOR;
        this.workspaceOverviewTicker.options.slope = c_slope;
        if((this.focusClone !== undefined) && (!value))
        {
            if(this.focusClone.minimizerProgress.progress > 500000)this.minimizeFocusWindow();
            else this.focusClone.setMinimizerTarget(0);
        }
        if(!value)
        {
            this.windowTicker.setTarget((this.windowLockPosition === "up")?1000000:0);
            this.workspaceOverviewTicker.setTarget((this.workspaceOverviewLockPosition === "up")?1000000:0);
        }
        this.workspaceSwitchTicker.setTargetToClosestGoalWithDirection(this.workspaceSwitchDirection, 25000);
        this.windowSwitchTicker.setTargetToClosestGoal();
        this.setDirty(DIRT_TYPE.FINE_CONTROL);
    }

    setWorkspaceSwitchTargetToClosestValidOne()
    {
        this.workspaceSwitchTicker.setTargetToClosestGoal();
    }

    setWindowTarget(target, position)
    {
        this.start();
        if(position !== undefined)this.windowLockPosition = position;
        if(target < 0)target = 0;
        if(target > 1000000)target = 1000000;
        this.windowTicker.setTarget(target);
    }

    setWorkspaceSwitchTarget(target, direction)
    {
        this.start();
        this.workspaceSwitchTicker.setTarget(target);
        this.workspaceSwitchDirection = direction;
    }

    setWorkspaceOverviewTarget(target, position)
    {
        this.start();
        if(position !== undefined)this.workspaceOverviewLockPosition = position;
        if(target < 0)target = 0;
        if(target > 1000000)target = 1000000;
        this.workspaceOverviewTicker.setTarget(target);
    }
    
    activateClone(clone)
    {
        clone.hyperWorkspace.activateClone(clone);
        this.setWindowTarget(0, "down");
        this.setWorkspaceOverviewTarget(0, "down");
    }
    
    enablePanels(force)
    {
        if(this.panelsEnabled&&!force)return;
        this.panelsEnabled = true;
        for (let i = 0, len = Main.panelManager.panels.length; i < len; i++) {
            if (Main.panelManager.panels[i])
            {
                Main.panelManager.panels[i]._disabled = false;
                Main.panelManager.panels[i].actor.show();
            }
        }
    }
    
    disablePanels(force)
    {
        if(!this.panelsEnabled&&!force)return;
        this.panelsEnabled = false;
        for (let i = 0, len = Main.panelManager.panels.length; i < len; i++) {
            if (Main.panelManager.panels[i])
            {
                Main.panelManager.panels[i]._disabled = true;
                Main.panelManager.panels[i]._leavePanel();
                Main.panelManager.panels[i].actor.hide();
            }
        }
    }

    setFocusWindowMinimizerTarget(target)
    {
        if(this.focusClone === undefined)return;
        this.focusClone.setMinimizerTarget(target);
    }

    setFocusWindow(window)
    {
        let n_value = (window===undefined)?undefined:this.hyperWorkspaces[window.get_workspace().index()].load().clones[window.get_stable_sequence().toString()];
        if(this.focusClone === n_value)return;
        // --- DEBUG ---
        // let phi = (x)=>(x===undefined)?"undefined":x.metaWindow.title;
        // global.log(phi(this.focusClone), phi(n_value))
        // --- DEBUG ---
        if(this.focusClone)this.focusClone.setIsFocusClone(false);
        this.focusClone = n_value;
        if(this.focusClone)this.focusClone.setIsFocusClone(true);
    }

    minimizeFocusWindow()
    {
        let clone = this.focusClone;
        this.setFocusWindow(undefined);
        mngr.preventMinimizeAnimation(clone.metaWindow.get_stable_sequence());
        clone.minimize();
    }

    notifyWindowWasMaximized(wid)
    {
        this.toldMaximizedWindow[wid] = true;
    }


    notifyWaitingWindowCountChanged()
    {
        this.setDirty(DIRT_TYPE.RETAIN_COUNT);
    }

    resetFocusWindow()
    {
        let window = global.display.get_focus_window();
        if(window && Main.isInteresting(window) && !this.windowHasFocusInhbition(window)) this.setFocusWindow(window);
        else this.setFocusWindow(undefined);
    }

    dropFocusWindow()
    {
        if(this.focusClone === undefined)return;
        this.setFocusWindow(undefined);
    }

    windowHasFocusInhbition(window)
    {
        let hw = this.hyperWorkspaces[window.get_workspace().index()];
        if(hw.loaded)return false;
        return hw.clones[window.get_stable_sequence().toString()].focusInhibition
    }

    onWorkspaceSwitchTick(n_p, o_p)
    {
        this.setDirty(DIRT_TYPE.WORKSPACE_SWITCH);
    }

    activateWorkspace(metaWorkspace)
    {
        mngr.preventNextDefaultWorkspaceEffect = true;
        metaWorkspace.activate(global.get_current_time());
        this.setWorkspaceOverviewTarget(0, "down");
    }

    onWorkspaceOverviewTick(n_p, o_p)
    {
        this.setDirty(DIRT_TYPE.WORKSPACE_OVERVIEW);
    }

    setDirty(dirtMask)
    {
        let n_dirt = this.dirty | dirtMask;
        if(n_dirt === this.dirty)return;
        this.dirty = n_dirt;
        if(n_dirt)mngr.engine.registerDirty(0, this);
    }

    onClean() //Hyperview
    {
        let dirt = this.dirty;
        this.dirty = 0;
        if(!this.started)return false; //Strange issue
        if(dirt & DIRT_TYPE.WINDOW)
        {
            let new_progress = this.windowTicker.progress;
            let old_progress = this.windowTicker.old_progress;
            this.hyperWorkspaces.forEach(hw => hw.setDirty(DIRT_TYPE.WINDOW));
            if((new_progress) < 1000000 && (old_progress === 1000000))this.enablePanels();
            this.incubatingWindows = this.incubatingWindows.filter((metaWin)=>{
                if(!metaWin.get_compositor_private())return true;
                let win = metaWin.get_compositor_private();
                if(metaWin.is_on_all_workspaces())
                {
                    this.hyperWorkspaces.filter(hw=>hw.loaded).forEach((hw)=>{
                        if(hw.shouldIncludeWindow(win))
                        {
                            hw.addCloneIfNotExist(win);
                            hw.setDirty(DIRT_TYPE.ELEMENT_POSITIONS);
                        }
                    });
                }
                else
                {
                    let hw = this.hyperWorkspaces[metaWin.get_workspace().index()];
                    if(hw.loaded && hw.shouldIncludeWindow(win))
                    {
                        hw.addCloneIfNotExist(win);
                        hw.setDirty(DIRT_TYPE.ELEMENT_POSITIONS);
                    }
                }
                return false;
            });
            if(this.incubatingWindows.length !== 0)this.dirty |= DIRT_TYPE.WINDOW;
        }
        if(dirt & DIRT_TYPE.WINDOW_SWITCH)
        {
            this.hyperWorkspaces[this.currentWorkspaceIndex].setDirty(DIRT_TYPE.WINDOW_SWITCH);
        }
        if(dirt & DIRT_TYPE.WORKSPACE_SWITCH) //Workspaces creation
        {
            let x_p = this.workspaceSwitchTicker.progress;
            let x_op = this.workspaceSwitchTicker.old_progress;
            if(x_p > ((global.screen.get_n_workspaces()-1)*1000000 + WORKSPACE_CREATION_THRESHOLD))
            {
                if(!this.hyperWorkspaces[global.screen.get_active_workspace_index()].isEmpty())
                {
                    let effectiveProgress = clamplog(x_p, 0, (global.screen.get_n_workspaces()-1)*1000000, 1000000/70);
                    let effectiveOldProgress = clamplog(x_op, 0, (global.screen.get_n_workspaces()-1)*1000000, 1000000/70);
                    let currentTarget = this.workspaceSwitchTicker.target;
                    let metaWorkspace = global.screen.append_new_workspace (false, global.get_current_time());
                    this.metaWorkspaces.push(metaWorkspace);
                    let hyperWorkspace = new HyperviewWorkspace(metaWorkspace, this);
                    this.hyperWorkspaces.push(hyperWorkspace);
                    this.computeWorkspaceDestinations();
                    this.workspaceSwitchTicker.options.goals.push((global.screen.get_n_workspaces()-1)*1000000);
                    this.workspaceSwitchTicker.fullJumpTo(effectiveProgress, effectiveOldProgress, currentTarget);
                    hyperWorkspace.load();
                    this.hyperWorkspaces.filter(x=>x.loaded).forEach(x=>x.setDirty(DIRT_TYPE.SELF_POSITION));
                    this.loadWorkspaceThreshold = undefined;
                }
            }
        }
        if(dirt & DIRT_TYPE.WORKSPACE_SWITCH) //Loading workspaces
        {
            let next = clamp(Math.round(this.workspaceSwitchTicker.progress/1000000), 0, global.screen.get_n_workspaces()-1);
            if(this.loadWorkspaceThreshold !== undefined)
            {
                if(((this.workspaceSwitchTicker.progress - this.loadWorkspaceThreshold)*(this.workspaceSwitchTicker.old_progress - this.loadWorkspaceThreshold) <= 0))
                {
                    if(this.isFineControlled && !this.allWorkspaceLoad)this.loadOnlyNeighborWorkspaces(next);
                    this.loadWorkspaceThreshold = undefined;
                }
            }
        }
        if(dirt & (DIRT_TYPE.WORKSPACE_OVERVIEW | DIRT_TYPE.WORKSPACE_SWITCH)) //Workspaces mvmnt
        {
            let x_p = this.workspaceSwitchTicker.progress;
            let y_pr = this.workspaceOverviewTicker.progress/1000000;
            let current = this.currentWorkspaceIndex;
            let primary = Main.layoutManager.primaryMonitor;
            if(this.workspaceSwitchTicker.progress !== this.workspaceSwitchTicker.old_progress) //natural switch
            {
                let next = clamp(Math.round(x_p/1000000), 0, global.screen.get_n_workspaces()-1);
                if(current !== next)
                {
                    this.activateWorkspace(this.metaWorkspaces[next]);
                }
                if((current - 1) === next) //GOING LEFT
                {
                    this.loadWorkspaceThreshold = (current-WORKSPACE_LOAD_THRESHOLD)*1000000;
                }
                else if((current + 1) === next) //GOING RIGHT
                {
                    this.loadWorkspaceThreshold = (current+WORKSPACE_LOAD_THRESHOLD)*1000000;
                }
            }
            this.lx_p = (primary.width+MARGIN_BETWEEN_WORKSPACES)*clamplog(x_p, 0, (global.screen.get_n_workspaces()-1)*1000000, 1000000/70)/1000000;
            this.hyperWorkspaces.forEach((x)=>x.setDirty(DIRT_TYPE.WORKSPACE_OVERVIEW | DIRT_TYPE.WORKSPACE_SWITCH));
            this.views.gradient.set_opacity(255-128*y_pr);
        }
        if(dirt & (DIRT_TYPE.WORKSPACE_OVERVIEW | DIRT_TYPE.WORKSPACE_SWITCH | DIRT_TYPE.WINDOW)) //Panels
        {
            let y_pr = this.workspaceOverviewTicker.progress/1000000;
            let pr = this.windowTicker.progress/1000000;
            if(!global.screen.get_monitor_in_fullscreen(Main.layoutManager.primaryMonitor.index))this.setPanelsOpacity((1-y_pr)*(1-y_pr)*(1-pr)*(1-pr)*255);
            else this.setPanelsOpacity(0);
        }
        if(dirt & DIRT_TYPE.ELEMENT_POSITIONS)
        {
            this.hyperWorkspaces.filter(x=>x.loaded).forEach(x=>x.setDirty(DIRT_TYPE.SELF_POSITION)); // ?
        }
        if(dirt & DIRT_TYPE.WORKSPACE_OVERVIEW)
        {
            if((this.workspaceOverviewTicker.progress === 1000000) && (this.workspaceOverviewTicker.old_progress !== 1000000))
            {
                this.workspaceOverviewEnabled = true;
                this.hyperWorkspaces.forEach(x=>x.onWorkspaceOverviewEnabled());
            }
            else if((this.workspaceOverviewTicker.progress !== 1000000) && (this.workspaceOverviewTicker.old_progress === 1000000))
            {
                this.workspaceOverviewEnabled = false;
                this.hyperWorkspaces.forEach(x=>x.onWorkspaceOverviewDisabled());
            }
            if((this.workspaceOverviewTicker.progress > 100000) && (this.workspaceOverviewTicker.old_progress <= 100000))
            {
                this.allWorkspaceLoad = true;
                this.loadAllWorkspaces();
            }
            else if((this.workspaceOverviewTicker.progress < 100000) && (this.workspaceOverviewTicker.old_progress >= 100000))
            {
                this.allWorkspaceLoad = false;
                this.loadOnlyNeighborWorkspaces(global.screen.get_active_workspace_index());
            }
        }
        //For all
        if(!this.isFineControlled)
        {
            if(this.debugSquare !== undefined)
            {
                this.debugSquare.set_position(20*this.waitingMinimizing, 0)
            }
            if((this.windowTicker.progress === 0) && (this.waitingMinimizing === 0) && this.workspaceSwitchTicker.onGoal() && (this.workspaceOverviewTicker.progress === 0) && this.windowSwitchTicker.onGoal())
            {
                if(this.shouldWindowSwitch)this.hyperWorkspaces[this.currentWorkspaceIndex].performWindowSwitch();
                this.stop();
            }
            else
            {
                if(this.windowTicker.progress === 1000000) this.disablePanels();
            }
        }
        return (this.dirty !== 0) && this.started;
    }

    computeWorkspaceDestinations()
    {
        let numberOfWorkspaces = this.hyperWorkspaces.length;
        let gridWidth = Math.ceil(Math.sqrt(numberOfWorkspaces));
        let gridHeight = Math.ceil(numberOfWorkspaces / gridWidth);
        let fractionX = DEFAULT_WORKSPACE_SLOT_FRACTION * (1. / gridWidth);
        let fractionY = DEFAULT_WORKSPACE_SLOT_FRACTION * (1. / gridHeight);
        let primary = Main.layoutManager.primaryMonitor;
        let scale = (fractionX<fractionY)?fractionX:fractionY;
        if(numberOfWorkspaces === 1)scale = 1; //override
        let [pw, ph] = [primary.width, primary.height];
        this.hyperWorkspaces.forEach(function(hyperWorkspace, i) {
            let xCenter = (0.5/gridWidth)+((i) % gridWidth) / gridWidth;
            if(i>=(gridHeight-1)*gridWidth)xCenter+=((gridHeight*gridWidth-numberOfWorkspaces)/2)/gridWidth;
            let yCenter = (0.5/gridHeight)+Math.floor((i / gridWidth)) / gridHeight;
            hyperWorkspace.setDestinationPosition(Math.round((xCenter-0.5)*pw), Math.round((yCenter-0.5)*ph));
            hyperWorkspace.setDestinationScale(scale);
            hyperWorkspace.setGridPosition(Math.floor((i / gridWidth)), (i % gridWidth));
        });
    }

    onKeyPress(actor, event)
    {
        return true;
    }

    onKeyRelease(actor, event)
    {
        let symbol = event.get_key_symbol();
        //global.log(symbol)
        if(symbol === 65377) // DEBUG
        {
            this.logView("", this.hyperstage);
            mngr.engine.logState();
        } //DEBUG
        return true;
    }

    logView(tabs, actor)
    {
        mngr.logToFile(tabs + actor.name + " " + actor.x + " " + actor.y + " " + actor.scale_x + " " + actor.opacity+"\n")
        //global.log(actor.get_children());
        actor.get_children().forEach(x => this.logView(tabs+"   ", x))
    }

    registerIncubatingWindows(metaWin)
    {
        this.incubatingWindows.push(metaWin);
        this.setDirty(DIRT_TYPE.WINDOW);
    }

    onWorkspaceChanged()
    {
        this.currentWorkspaceIndex = global.screen.get_active_workspace_index();
        if(this.started) this.loadWorkspace(this.currentWorkspaceIndex);
        else if(this.workspaceSwitchTicker.onGoal())this.workspaceSwitchTicker.jumpTo(this.currentWorkspaceIndex*1000000);
    }

    addWindowSwitchTargetDelta(delta)
    {
        this.windowSwitchTicker.addDelta(delta);
    }

    setWindowSwitchTargetToTheClosestValidOne()
    {
        this.windowSwitchTicker.setTargetToClosestGoal();
    }

    onWindowSwitchTick(n_p, o_p, macroOffset)
    {
        this.setDirty(DIRT_TYPE.WINDOW_SWITCH);
    }

    resetWindowSwitchOrder()
    {
        this.hyperWorkspaces[this.currentWorkspaceIndex].resetWindowSwitchOrder();
    }

    onWorkspaceClicked(hyperWorkspace)
    {
        this.activateWorkspace(hyperWorkspace.metaWorkspace);
        this.workspaceSwitchTicker.jumpTo(this.currentWorkspaceIndex*1000000);
        this.workspaceSwitchTicker.old_progress = this.workspaceSwitchTicker.progress;
        this.setDirty(DIRT_TYPE.WORKSPACE_SWITCH);
    }

    removeWorkspace(hyperWorkspace)
    {
        let metaWorkspace = hyperWorkspace.metaWorkspace;
        this.metaWorkspaces = this.metaWorkspaces.filter(el => (el != metaWorkspace));
        this.hyperWorkspaces = this.hyperWorkspaces.filter(el => (el != hyperWorkspace));
        this.computeWorkspaceDestinations();
        if(metaWorkspace == global.screen.get_active_workspace()) mngr.preventNextDefaultWorkspaceEffect = true;
        global.screen.remove_workspace(hyperWorkspace.metaWorkspace, global.get_current_time());
        hyperWorkspace.destroy();
        this.hyperWorkspaces.filter(x=>x.loaded).forEach(x=>x.syncClones());
        this.setDirty(DIRT_TYPE.ELEMENT_POSITIONS);
    }
};

const iface = "\
    <node> \
      <interface name='org.aodenis.gestured'> \
        <signal name='UpdateGesture'> \
            <arg direction='out' type='y'/> \
            <arg direction='out' type='n'/> \
            <arg direction='out' type='d'/> \
            <arg direction='out' type='d'/> \
        </signal> \
        <method name='StayAlive'> \
        </method> \
      </interface> \
    </node>";

class GestureManager {
    constructor()
    {
        try
        {
            this.config = new SettingsManager();
            const serverProxy = Gio.DBusProxy.makeProxyWrapper(iface);
            this.proxy = new serverProxy(Gio.DBus.system, 'org.aodenis.gestured', "/");
            this.proxy.connectSignal('UpdateGesture', this.proxyHandleGestureUpdate.bind(this));
            this.currentGesture = null;
            this.isGesturing = false;
            this.enabled = false;
            this.startWindowProgress = 0;
            this.startWorkspaceSwitchProgress = 0;
            this.inhibitedActors = {};
            this.logFile = null;
            this.logFileStream = null;
            this.logFileError = null;
        }
        catch(e)
        {
            print_error(e);
        }
    }

    enable()
    {
        try
        {
            if(this.enabled)return;
            this.logFile = null;
            this.logFileStream = null;
            this.logFileError = null;
            this.safeRestartBeginTime = undefined;
            this.original_startWindowEffect = Main.wm._startWindowEffect;
            Main.wm._startWindowEffect = this.startWindowEffectHook.bind(this);
            this.original_switchWorkspace = Main.wm._switchWorkspace;
            Main.wm._switchWorkspace = this.switchWorkspaceHook.bind(this);
            this.preventNextDefaultWorkspaceEffect = false;
            this.enabled = true;
            this.engine = new ProgressEngine();
            this.interval = setInterval(this.protect(this.onStayAliveTick), 5000);
            this.proxy.StayAliveRemote(function(){});
            this.hyperview = new Hyperview();
        }
        catch(e)
        {
            print_error(e);
        }
    }

    disable()
    {
        try
        {
            if(!this.enabled)return;
            this.enabled = false;
            Main.wm._startWindowEffect = this.original_startWindowEffect;
            Main.wm._switchWorkspace = this.original_switchWorkspace;
            clearInterval(this.interval);
            this.interval = null;
            this.isGesturing = false;
            this.currentGesture = null;
            this.hyperview.destroy();
            this.hyperview = undefined;
            this.engine.destroy();
            this.engine = null;
            if(this.logFileStream !== null)this.logFileStream.close(null)
            this.logFileStream = null;
            this.logFile = null;
            this.logFileError = null;
        }
        catch(e)
        {
            print_error(e);
        }
    }

    logToFile(text)
    {
        if((this.logFileStream === null) && !this.config.debugLogFileDisabled)
        {
            [this.logFile, this.logFileStream] = Gio.file_new_tmp("CinnamonGestures-XXXXXX", this.logFileStream, this.logFileError)
            if(this.logFileStream === null)
            {
                global.log("Error opening file", this.logFileError);
                return false;
            }
        }
        if(this.logFileStream !== null)
        {
            if(this.logFileStream.output_stream.write(text, null, this.logFileError) === -1)
            {
                global.log(this.logFileError)
                this.logFileStream.close(null)
                this.logFileStream = null;
                return false;
            }
            else return true;
        }
        return false;
    }

    proxyHandleGestureUpdate(proxy, sender, [a, b, c, d])
    {
        try
        {
            this.handleGestureUpdate(a, b, c, d);
        }
        catch(e)
        {
            print_error(e);
        }
    }

    handleGestureUpdate(type, nfingers, dx, dy) {
        const START_TYPE = 0;
        const STOP_TYPE = 1;
        const UPDATE_TYPE = 2;
        if(type > 2)return; //skip pinches
        if((type === UPDATE_TYPE) && this.isGesturing) this.updateGesture(dx, dy);
        else if((type === START_TYPE) && (!this.isGesturing))this.startGesture(nfingers, dx, dy);
        else if((type === STOP_TYPE) && this.isGesturing) this.stopGesture();
        else if((type === START_TYPE) && this.isGesturing)
        {
            this.stopGesture();
            this.startGesture(nfingers, dx, dy);
        }
    }

    /* Function managing current state */
    stopGesture()
    {
        this.safeRestartBeginTime = undefined;
        this.isGesturing = false;
        this.onGestureDeath();
        this.currentGesture = null;
    }

    updateGesture(dx,dy)
    {
        if(!this.config.windowSwitchEnabled && (this.currentGesture.nf === 3))dx = 0;
        this.currentGesture.x += dx;
        this.currentGesture.y += dy;
        this.currentGesture.ax += Math.abs(dx);
        this.currentGesture.ay += Math.abs(dy);
        if(this.safeRestartBeginTime !== undefined)
        {
            if(((gTime()-this.safeRestartBeginTime) > 4000) && ((this.currentGesture.ax+this.currentGesture.ay)<100))
            {
                global.reexec_self();
            }
        }
        this.onGestureUpdated(dx,dy);
    }

    startGesture(nf, dx, dy)
    {
        this.gestureStartTime = undefined;
        this.isGesturing = true;
        this.currentGesture = {nf: nf, x: 0, y: 0, ax: 0, ay: 0};
        if((nf === 4) && this.config.fourFingersCinnamonRestart)this.safeRestartBeginTime = gTime();
        this.onGestureStart();
        this.updateGesture(dx, dy);
    }

    /* Function for reactions */

    onGestureStart()
    {
        // 3 and 4
        this.hyperview.start(true);
        if(!this.hyperview.started)return;
        this.startWindowProgress = this.hyperview.windowTicker.progress;
        this.lastWindowSwitchValue = 0;
        this.startWorkspaceSwitchProgress = this.hyperview.workspaceSwitchTicker.progress;
        this.startWorkspaceOverviewProgress = this.hyperview.workspaceOverviewTicker.progress;
        this.canSwitch = true;
        this.canSwitchWorkspaces = (this.startWorkspaceOverviewProgress <= 200000);
        if(this.currentGesture.nf === 3)
        {
            if(this.startWindowProgress !== 0)this.hyperview.dropFocusWindow();
            else this.hyperview.resetFocusWindow();
        }
        else if(this.currentGesture.nf === 4)
        {
            this.hyperview.dropFocusWindow();
            this.hyperview.loadNeighborWorkspaces();
        }
    }

    onGestureUpdated(dx, dy)
    {
        if(!this.hyperview.started)return;
        if(this.currentGesture.nf === 3)
        {
            let wantedTargetY = (this.startWindowProgress - this.currentGesture.y*5000);
            this.hyperview.shouldWindowSwitch = (this.currentGesture.y>0);
            if(wantedTargetY >= 20000) this.hyperview.dropFocusWindow(); // we're moving up
            
            if(this.startWindowProgress === 0)
            {
                if(this.canSwitch && ((WINDOW_SWITCH_WEIGHT*Math.abs(this.currentGesture.x)) >= Math.abs(this.currentGesture.y)) && (wantedTargetY < 10))
                {
                    this.hyperview.addWindowSwitchTargetDelta(-WINDOW_SWITCH_FACTOR*dx);
                    this.hyperview.setWindowTarget(0, "down");
                    this.hyperview.setFocusWindowMinimizerTarget(0);
                }
                else
                {
                    if(this.canSwitch)this.hyperview.resetWindowSwitchOrder();
                    this.canSwitch = false;
                    this.hyperview.setWindowSwitchTargetToTheClosestValidOne();
                    this.hyperview.setWindowTarget(clamp(wantedTargetY, 0, 1000000), (this.currentGesture.y <= 0)?"up":"down");
                    this.hyperview.setFocusWindowMinimizerTarget(clamp(-wantedTargetY*0.66, 0, 1000000));
                }
            }
            else
            {
                this.hyperview.setWindowSwitchTargetToTheClosestValidOne();
                this.hyperview.setFocusWindowMinimizerTarget(0);
                this.hyperview.setWindowTarget(clamp(wantedTargetY, 0, 1000000), (this.currentGesture.y <= 0)?"up":"down");
            }
        }
        else if(this.currentGesture.nf === 4)
        {
            let wantedTargetY = (this.startWorkspaceOverviewProgress - this.currentGesture.y*5000);
            if(((this.startWorkspaceOverviewProgress - this.currentGesture.y*5000) <= 200000) && this.canSwitchWorkspaces) //if canSwitchWorkspace and not too high/down
            {
                let wantedTargetX = (this.startWorkspaceSwitchProgress - this.currentGesture.x*2500);
                let offset = (- 5*this.currentGesture.x);
                let direction = "still";
                if(offset > 200)direction = "right";
                else if(offset < - 200)direction = "left";
                this.hyperview.setWorkspaceSwitchTarget(wantedTargetX, direction);
            }
            else //vertical movement
            {
                this.canSwitchWorkspaces = false;
                this.hyperview.setWorkspaceSwitchTargetToClosestValidOne(); //sorry for that name
            }
            this.hyperview.setWorkspaceOverviewTarget(wantedTargetY,  (((wantedTargetY>300000)&&(this.currentGesture.y <= 0))?"up":"down"));
        }
    }

    onGestureDeath()
    {
        if(!this.hyperview.started)return;
        this.hyperview.setFineControlled(false);
    }

    startWindowEffectHook(cinnamonwm, name, actor, args, overwriteKey)
    {
        try
        {
            const index = actor.get_meta_window().get_stable_sequence().toString();
            if((name === "minimize") && this.inhibitedActors[index])
            {
                delete this.inhibitedActors[index];
                cinnamonwm.completed_minimize(actor);
            }
            else return this.original_startWindowEffect.bind(Main.wm)(cinnamonwm, name, actor, args, overwriteKey);
        }
        catch(e)
        {
            print_error(e);
        }
    }

    switchWorkspaceHook(cinnamonwm, from, to, direction)
    {
        try
        {
            if(this.preventNextDefaultWorkspaceEffect)
            {
                cinnamonwm.completed_switch_workspace();
                this.preventNextDefaultWorkspaceEffect = false;
                return;
            }
            else this.original_switchWorkspace.bind(Main.wm)(cinnamonwm, from, to, direction);
        }
        catch(e)
        {
            print_error(e);
        }
    }

    preventMinimizeAnimation(seq)
    {
        this.inhibitedActors[seq.toString()] = true;
    }

    onStayAliveTick()
    {
        this.proxy.StayAliveRemote(function(){});
        if(this.currentGesture !== null) //safe restart in case of crash
        {
            if(this.currentGesture.nf === 4)
            {
                if(this.safeRestartBeginTime !== undefined)
                {
                    if(((gTime()-this.safeRestartBeginTime) > 4000) && ((this.currentGesture.ax+this.currentGesture.ay)<100))
                    {
                        global.reexec_self();
                    }
                }
            }
        }
    }
};

var mngr = null;

function init()
{
    if(mngr === null)mngr = new GestureManager();
}

function enable()
{
    if(mngr === null)init();
    mngr.enable();
}

function disable()
{
    if(mngr !== null)mngr.disable();
    mngr = null;
}

Signals.addSignalMethods(Hyperview.prototype);
Signals.addSignalMethods(HyperviewWindow.prototype);
Hyperview.prototype.protect = protect;
HyperviewWindow.prototype.protect = protect;
HyperviewWorkspace.prototype.protect = protect;
GestureManager.prototype.protect = protect;
