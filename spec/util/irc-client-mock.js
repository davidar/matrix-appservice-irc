/*
 * Mock replacement for 'irc'.
 */
"use strict";
var q = require("q");
var util = require("util");
var EventEmitter = require('events').EventEmitter;

var instanceEmitter, clientEmitter;
var DELIM = "_DELIM_";
var instances = {
    // addr +"_DELIM_" + nick : Client
};

function getClient(addr, nick) {
    return instances[addr + DELIM + nick];
}
function setClient(client, addr, nick) {
    instances[addr + DELIM + nick] = client;
    instanceEmitter.emit("client_" + addr + "_" + nick, client);
}
function setClientNick(addr, oldNick, newNick) {
    var client = instances[addr + DELIM + oldNick];
    client.nick = newNick;
    instances[addr + DELIM + newNick] = client;
    instances[addr + DELIM + oldNick] = null;
    instanceEmitter.emit("client_" + addr + "_" + newNick, client);
}

/**
 * Reset all mock IRC clients.
 */
module.exports._reset = function() {
    Object.keys(instances).forEach(function(k) {
        var cli = instances[k];
        if (cli) {
            cli._dead = true;
        }
    });
    instances = {};
    // emitter when clients are added
    instanceEmitter = new EventEmitter();
    // emitter when functions are called on a client.
    clientEmitter = new EventEmitter();
};

function Client(addr, nick, opts) {
    // store this instance so tests can grab it and manipulate it.
    var client = this;
    this.addr = addr;
    this.nick = nick;
    this.opts = opts;
    this.chans = {};

    var spies = [
        "connect", "whois", "join", "send", "action", "ctcp", "say",
        "disconnect", "notice", "part"
    ];
    spies.forEach(function(fnName) {
        client[fnName] = jasmine.createSpy("Client." + fnName);
        client[fnName].andCallFake(function() {
            if (client._dead) { return; }
            // emit that the action was performed along with the args. This can
            // be caught in the form:
            // clientEmitter.on(addr+"_"+nick,
            // function(fnName, client, arg1, arg2 ...)) {
            //     // stuff
            // }
            var args = [client.addr + "_" + client.nick, fnName, client];
            for (var i = 0; i < arguments.length; i++) {
                args.push(arguments[i]);
            }
            console.log("IrcClient.emit => %s", JSON.stringify(args));
            clientEmitter.emit.apply(clientEmitter, args);
        });
    });

    this._changeNick = function(oldNick, newNick) {
        setClientNick(client.addr, oldNick, newNick);
        // emit the nick message from the server
        process.nextTick(function() {
            // send a response from the IRC server
            client.emit("nick", oldNick, newNick);
        });
    };

    this._invokeCallback = function(cb) {
        var d = q.defer();
        process.nextTick(function() {
            if (cb) {
                cb();
            }
            d.resolve();
        });
        return d.promise;
    };

    setClient(client, addr, nick);
}
util.inherits(Client, EventEmitter);

/**
 * A mock IRC Client class.
 */
module.exports.Client = Client;

/**
 * Get an IRC client with the given domain and nick when the AS makes one.
 * @param {String} addr : The IRC server address.
 * @param {String} nick : The IRC nick to obtain a client for.
 * @return {Promise} Which is resolved with the IRC {@link Client} instance.
 */
module.exports._findClientAsync = function(addr, nick) {
    var client = getClient(addr, nick);
    if (client) {
        return q(client);
    }
    var d = q.defer();
    instanceEmitter.once("client_" + addr + "_" + nick, function(client) {
        d.resolve(client);
    });
    return d.promise;
};

/**
 * Invoke a function when the AS invokes a function on the mock IRC client.
 * @param {String} addr : The IRC server address for the client.
 * @param {String} nick : The IRC nick for the client.
 * @param {String} fnName : The function name that the AS will invoke.
 * @param {Function} invokeFn : The function to invoke. The first parameter will
 * be the {@link Client} with the remaining parameters being the parameters the
 * AS invoked the original function with.
 */
module.exports._whenClient = function(addr, nick, fnName, invokeFn) {
    console.log("Add listener(%s) for fn=%s", (addr + "_" + nick), fnName);
    clientEmitter.on((addr + "_" + nick), function(invokedFnName, client) {
        if (invokedFnName !== fnName) {
            return;
        }
        console.log("Irc.Client.on(%s) fn=%s", (addr + "_" + nick), invokedFnName);
        // invoke function with the remaining args (incl. Client object)
        var args = [];
        for (var i = 1; i < arguments.length; i++) {
            args.push(arguments[i]);
        }
        invokeFn.apply(this, args);
    });
};

/**
 * Automatically join IRC channels for a given IRC client.
 * @param {String} addr : The IRC server address for the client.
 * @param {String} nick : The IRC nick for the client.
 * @param {String|Array} channels : The list of channels to automatically join.
 */
module.exports._autoJoinChannels = function(addr, nick, channels) {
    if (typeof channels === "string") {
        channels = [channels];
    }
    module.exports._whenClient(addr, nick, "join", function(client, chan, cb) {
        if (channels.indexOf(chan) != -1) {
            client.chans[chan] = {};
            client._invokeCallback(cb);
        }
    });
};

/**
 * Automatically join IRC networks for a given IRC client.
 * @param {String} addr : The IRC server address for the client.
 * @param {String} nick : The IRC nick for the client.
 * @param {String|Array} networks : The list of networks to automatically join.
 */
module.exports._autoConnectNetworks = function(addr, nick, networks) {
    if (typeof networks === "string") {
        networks = [networks];
    }
    module.exports._whenClient(addr, nick, "connect", function(client, cb) {
        if (networks.indexOf(client.addr) != -1) {
            client._invokeCallback(cb);
        }
    });
};
