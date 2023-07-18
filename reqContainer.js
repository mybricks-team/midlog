/**
 * 请求容器，存储每个请求中打点的日志信息，并传递给strategyManager做刷新决策
 */
var os = require('os');
var path = require('path');
var util = require('./lib/util.js');
var strategyManager = require('./strategyManager');
var layout = require('./lib/layout');
var libLoggerInstance;
var Env;
var LOG_TYPES = new Set();

// 默认每个缓冲最大容量为1kB
// TODO: 由于使用rocker-mvc的分段日志（各中间件单独日志），因此在多进程、多日志级别、多中间件的情况下放弃使用 双缓冲机制
const MAXCACHESIZE = 0 * 1024;
// 默认刷新缓冲超时为10s
const FLUSHTIMEOUT = 10000;
//获取用户目录
if (!process.env['HOME']) {
  DEFAULT_LOGDIR = '/home/www/logs';
}else{
  DEFAULT_LOGDIR = path.join(process.env['HOME'],'logs');
}
const DEFAULT_NAME = 'info.log';
const DEFAULT_PATTERN = '%d %p [%z]%x{vtrace} %m%n';
let DEFAULT_TOKEN = {};
const DEFAULT_APPENDER = [{
    type: 'TRACE',
    logdir: '/home/www/logs',
    name: 'info.log',
  },{
    type: 'DEBUG',
    logdir: '/home/www/logs',
    name: 'info.log',
  },{
    type: 'INFO',
    logdir: '/home/www/logs',
    name: 'info.log'
  },{
    type: 'WARN',
    logdir: '/home/www/logs',
    name: 'info.log',
  },{
    type: 'ERROR',
    logdir: '/home/www/logs',
    name: 'info.log',
  }];

// hack console.fatal
console.fatal = console.error; 

function Log(options) {
  var env = options.env || process.env.NODE_ENV || "dev";
  options.appender = options.appender || DEFAULT_APPENDER;
  var vtrace = options.vtrace;
  var apdKeys = Object.keys(options.appender);
  var manager = {};
  var layer = {};
  LOG_TYPES.clear();
  let appName = 'application';
  
  DEFAULT_TOKEN = {
    vtrace: ()=>{
      let result = vtrace && vtrace();
      if(result){
        return ' ' + result;
      }else{
        return '';
      }
    }
  };
  options.appender.forEach(function(config){
    var type = config.type.toLowerCase();
    config.tokens = DEFAULT_TOKEN;

    LOG_TYPES.add(`${type}`);

    manager[type] = manager[type] || {};
    if(env === 'dev'){}else{
      manager[type][appName] = strategyManager({
        level: type,
        logdir: path.join(config.logdir || DEFAULT_LOGDIR,appName),
        rollingFile: config.rollingFile,
        name: config.name || DEFAULT_NAME,
        nameformat: config.nameformat,
        duration: config.duration,
        mkdir: true, 
        cacheSize: typeof config.cacheSize == 'number' ? config.cacheSize : MAXCACHESIZE,
        flushTimeout: typeof config.flushTimeout == 'number' ? config.flushTimeout : FLUSHTIMEOUT
      });
    }

    // 创建layout实例
    layer[type] = layer[type] || {};
    layer[type][appName] = layout.patternLayout(config.pattern || DEFAULT_PATTERN, config.tokens);
  });

  // str: 写入的数据
  // level: 日志级别
  // mode: 是否刷新缓冲
  function _write(appName,str,level,mode) {
    //only development env will output to console
    if (env === 'dev') {
      if(console[level]){
        console[level](str.toString())
      }else{
        console.dir(level,str.toString());
      }
      return;
    }

    if(Array.isArray(str)){
      str = str.join(os.EOL);
    }

    try{
      manager[level.toLowerCase()][appName].write(str + os.EOL);
      if(mode == 'flush'){
        manager[level.toLowerCase()][appName].close();
      }
    }catch(e){
      console.error('MidLog日志写出错！！');
      console.error(e.stack);
    }
  }

  // 根据传入的参数判断是否需要缓存每个请求的日志信息
  function _generateLogger(cache) {
    var logger = {};

    LOG_TYPES.forEach(function(type) {
      // appName： 识别调用接口的应用名
      logger[type] = function(msg,appName) {
        if (!msg)
          return;

        let fullAppName = 'application';
        if(appName != 'application'){
          fullAppName = '@rockerjs/' + appName;
        }  
        if(layer[type.toLowerCase()] && !layer[type.toLowerCase()][appName]){
          manager[type] = manager[type] || {};
          if(env === 'dev'){}else{
            // 中间件日志分片
            manager[type][appName] = strategyManager({
              level: type,
              logdir: path.join(DEFAULT_LOGDIR,appName),
              rollingFile: true,
              duration: null,
              name: DEFAULT_NAME,
              nameformat: `[info-]YYYYMMDD[.log]`,
              mkdir: true,
              cacheSize: MAXCACHESIZE,
              flushTimeout: FLUSHTIMEOUT
            });
          }
          // 创建layout实例
          layer[type] = layer[type] || {};
          layer[type][appName] = layout.patternLayout(DEFAULT_PATTERN, DEFAULT_TOKEN);
        }

        try{
          msg = '[' + fullAppName + '] ' + layer[type.toLowerCase()][appName]({
            data: msg,
            level: type.toUpperCase(),
            startTime: new Date(),
            pid: process.pid
          });
        }catch(e){
          msg = '[' + fullAppName + '] ' + msg;
          console.error('MidLog无法找到配置的中间件');
          console.error(e.stack);
        }

        if (cache) {
          cache[type].push(msg);
        } else {
          _write(appName,msg,type);
        }

      }
    });

    // cache一定是个数组
    if (cache) {
      logger.flush = function() {
        LOG_TYPES.forEach(function(type){
          _write('application',cache[type],type,'flush');
        });
      }
    }

    return logger;
  }

  return {
    //如果有cache代表需要做异步处理
    generate: function(cache) {
      return _generateLogger(cache);
    }
  }
}

var firstValve = function*(next){
  //记录基础的请求时间,跳过静态资源
  var ctx = this;
  var start = new Date;
  //logs缓存，打log不会真的输出，而是记录
  var logsMemory = {
    info: [],
    trace: [],
    error: []
  };

  ctx.logger = libLoggerInstance.generate(logsMemory);
  ctx.logger.info('------request start------')
  try{
    yield* next;
  }catch(err){

    this.logger.error(util.error2string(err));
    this.logger.flush();

    //告诉全局的error监控，此错误已经处理过了
    err.hasHandled = true;
    //抛出去 方便其他程序监控
    ctx.throw(err);
  }

  // todo: delete
  var res = this.res;

  var onfinish = done.bind(null, 'finish');
  var onclose = done.bind(null, 'close');
  res.once('finish', onfinish);
  res.once('close', onclose);

  function done(event) {
    res.removeListener('finish', onfinish);
    res.removeListener('close', onclose);

    ctx.logger.info('******request end******');
    ctx.logger.flush();

  }
}

var firstValve2 = async function(ctx,next){
  //记录基础的请求时间,跳过静态资源
  var start = new Date;
  //logs缓存，打log不会真的输出，而是记录
  var logsMemory = {
    info: [],
    trace: [],
    error: []
  };

  ctx.logger = libLoggerInstance.generate(logsMemory);
  ctx.logger.info('------request start------')
  try{
    await next();
  }catch(err){

    this.logger.error(util.error2string(err));
    this.logger.flush();

    //告诉全局的error监控，此错误已经处理过了
    err.hasHandled = true;
    //抛出去 方便其他程序监控
    ctx.throw(err);
  }

  // todo: delete
  var res = ctx.res;

  var onfinish = done.bind(null, 'finish');
  var onclose = done.bind(null, 'close');
  res.once('finish', onfinish);
  res.once('close', onclose);

  function done(event) {
    res.removeListener('finish', onfinish);
    res.removeListener('close', onclose);

    ctx.logger.info('******request end******');
    ctx.logger.flush();

  }
}

module.exports = function(options) {
  options = options || {};
  Env = options.env || process.env.NODE_ENV || "dev";

  // libLoggerInstance = Log({
  //   env: Env,
  //   appender: options.appender
  // });

  return {
    log: firstValve,
    log4koa2: firstValve2,
    Log
  };
};
