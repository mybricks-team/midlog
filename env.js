"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function getLocalIp() {
    var os = require('os');
    var ifaces = os.networkInterfaces();
    var ipRst = null;
    for (var dev in ifaces) {
        var alias = 0;
        if (dev.indexOf('en') != -1 || dev.indexOf('eth') != -1 || dev.indexOf('Eth') != -1) {
            ifaces[dev].forEach(function (details) {
                if (details.family == 'IPv4' && !/^127.0.\d+.\d+$/g.test(details.address)) {
                    ipRst = details.address;
                    ++alias;
                }
            });
        }
    }
    return ipRst;
}
exports.getEnv = function () {
    var localIp = getLocalIp();
    if (localIp && localIp.split('.')[0] == '10') {
        return 'server';
    }
    else {
        return 'dev';
    }
};
