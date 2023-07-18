'use strict';

import { init, _Logger, Tracelocal } from "@rockerjs/common";
import * as _ from "lodash";
import * as logFactory from "./reqContainer";
import { getEnv } from './env';

const DEFAULT_APPENDER = [{
    type: 'trace',
    rollingFile: true,
},{
    type: 'debug',
    rollingFile: true,
},
{
    type: 'INFO',
    rollingFile: true,
},{
    type: 'ERROR',
    rollingFile: true,
},
{
    type: 'fatal',
    rollingFile: true,
},{
    type: 'WARN',
    rollingFile: true,
}];

declare type APPType = {
    type: string,
    logdir?: string,
    name?: string,
    pattern?: string,
    rollingFile?: boolean,
    duration?: number,
    nameformat?: string,
    tokens?: object,
    cacheSize?: number,
    flushTimeout?: number
}[];

declare type MidWareType = {
    logdir: string,
    name: string,
    pattern?: string,
    rollingFile?: boolean,
    duration?: number,
    nameformat?: string,
    tokens?: object,
    cacheSize?: number,
    flushTimeout?: number
};

declare type MidlogConfig = { 
    env: string,
    vtrace?: Function,
    appender: APPType,
    midwareAppender?: {
        [propName: string]: MidWareType[]
    }
};

export class MidLog extends _Logger {

    private static midwareReg: RegExp = /@rockerjs\/([^\/]+)/gi ;
    public static singleton: { trace: Function, debug: Function, info: Function, warn: Function, error: Function, fatal: Function };

    constructor(op?: MidlogConfig) {
        super();
        if (!MidLog.singleton) {
            MidLog.config(op);
        }
        // 用户提供配置，则重新实例化Midlog实例
        if (op) {
            MidLog.config(op);
        }
    }

    public static config (op?: MidlogConfig) {
        let appender, vtrace, env = op && op.env || process.env.NODE_ENV || getEnv();
        if(op && op.appender){
            appender = op.appender;
        }else{
            appender = DEFAULT_APPENDER;
        }

        if(op && op.vtrace){
            vtrace = op.vtrace;
        }else{
            vtrace = ()=>{
                let traceId = '';
                try{
                    traceId = Tracelocal.id;
                }catch(e){
                }
                try{
                    if(!traceId){
                        traceId = Tracelocal.get('id');
                    }
                }catch(e){
                }
                return traceId;
            };
        }

        let params = {
            env,
            appender,
            vtrace
        };
        let { Log } = logFactory(params);

        MidLog.singleton = Log({
            env,
            appender,
            vtrace
        }).generate();
    }

    private static getStackInfn(): string {
        var stack = (new Error().stack).split('\n');
        // 获取调用 Common.logger.log()接口的中间件，通过堆栈可以找到调用名称，即 ”at Dep.warn (/Users/young/github/rocker-mvc/node_modules/@vdian/dep/index.js:15:32)',“
        /*
        FORMAT：
        [ 'Error',
        '    at MidLog.warn (/Users/young/github/rocker-mvc/node_modules/@vdian/midlog/index.js:24:21)',
        '    at Dep.warn (/Users/young/github/rocker-mvc/node_modules/@vdian/dep/index.js:15:32)',
        '    at Object.<anonymous> (/Users/young/github/rocker-mvc/node_modules/@vdian/dep/index.js:19:5)',
        '    at Module._compile (module.js:643:30)',
        '    at Object.Module._extensions..js (module.js:654:10)',
        '    at Module.load (module.js:556:32)',
        '    at tryModuleLoad (module.js:499:12)',
        '    at Function.Module._load (module.js:491:3)',
        '    at Module.require (module.js:587:17)',
        '    at require (internal/module.js:11:18)' ] */
        
        var midName = '';
        stack[4].replace(MidLog.midwareReg,(all: string, $1: string)=>{
            midName = $1;
            return $1;
        });
        midName = midName.trim() ?  midName.toLowerCase() : 'application';
        // 防止vitamin node客户端与jar冲突
        if(midName == 'vitamin') {
            midName = 'vitamin-node';
        }
        return midName;
    }

    public trace(data): any {
        let error = arguments[1];
        data = _.toString(data) == '[object Object]' ? JSON.stringify(data) : data;
        if(!error){
            MidLog.singleton.trace(data,MidLog.getStackInfn());
        }else{
            MidLog.singleton.trace(data + `\n${error.message}\n${error.stack}`,MidLog.getStackInfn());
        }
    }

    public debug(data) {
        let error = arguments[1];
        data = _.toString(data) == '[object Object]' ? JSON.stringify(data) : data;
        if(!error){
            MidLog.singleton.debug(data,MidLog.getStackInfn());
        }else{
            MidLog.singleton.debug(data + `\n${error.message}\n${error.stack}`,MidLog.getStackInfn());
        }
    }

    public info(data) {
        let error = arguments[1];
        data = _.toString(data) == '[object Object]' ? JSON.stringify(data) : data;
        if(!error){
            MidLog.singleton.info(data,MidLog.getStackInfn());
        }else{
            MidLog.singleton.info(data + `\n${error.message}\n${error.stack}`,MidLog.getStackInfn());
        }
    }

    public warn(data) {
        let error = arguments[1];
        data = _.toString(data) == '[object Object]' ? JSON.stringify(data) : data;
        if(!error){
            MidLog.singleton.warn(data,MidLog.getStackInfn());
        }else{
            MidLog.singleton.warn(data + `\n${error.message}\n${error.stack}`,MidLog.getStackInfn());
        }
    }

    public error(data) {
        let error = arguments[1];
        data = _.toString(data) == '[object Object]' ? JSON.stringify(data) : data;
        if(!error){
            MidLog.singleton.error(data,MidLog.getStackInfn());
        }else{
            MidLog.singleton.error(data + `\n${error.message}\n${error.stack}`,MidLog.getStackInfn());
        }
    }

    public fatal(data: string) {
        let error = arguments[1];
        data = _.toString(data) == '[object Object]' ? JSON.stringify(data) : data;
        if(!error){
            MidLog.singleton.fatal(data,MidLog.getStackInfn());
        }else{
            MidLog.singleton.fatal(data + `\n${error.message}\n${error.stack}`,MidLog.getStackInfn());
        }
    }
}

init({
    Logger: () => {
        return new MidLog();
    }
});