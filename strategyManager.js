// 功能：1、调度策略 2、日志删除 3、日志分片
'use strict';

var fs = require('fs');
var path = require('path');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var moment = require('moment');
var mkdirp = require('mkdirp');
// 日志删除模块
var delLogTask = require('./lib/del_log');

var ONE_MINUTE = 60000;
var ONE_HOUR = 60 * ONE_MINUTE;
var ONE_DAY = 24 * ONE_HOUR;
var DEFAULT_FLUSH_TIMOUT = 2000;
// 分片等待时间
var SHARDING_WAIT = 4000;

// pm2 cluster多进程下，在文件分片操作中需要指定特定进程进行操作
// warning：线上曾出现日志被重复分片的情况，这是由于线上rocker-agent-tool所在子进程中没有NODE_APP_INSTANCE环境变量导致
const isSelectedWorker = process.env.NODE_APP_INSTANCE == "0" || !process.env.NODE_APP_INSTANCE;

/**
 * StrategyManager, make the strategy of 2 buffers.
 *
 * log file name is concat with `prename + format + ext`.
 *
 * @param  {Object} options
 *  - {String} logdir, this dir must exists.
 *  - {String} name, should be the real name of the log file
 *  - {String} nameformat, default is '[info.]YYYY-MM-DD[.log]',
 *    @see moment().format(): http://momentjs.com/docs/#/displaying/format/
 *    Also support '{pid}' for process pid.
 *  - {String} [encoding], default is utf-8, other encoding will encode by iconv-lite
 *  - {Number} [duration], default is one houre(24 * 3600000 ms), must >= 60s.
 *  - {String} [mode], default is '0666'.
 *  - {Number} [flushTimeout] the duration of flush buffer , default is 1000ms
 *  - {Number} [cacheSize] the maximum value of each buffer , default is 10kB
 *  - {Boolean} [mkdir] try to mkdir in each cut, make sure dir exist.
 *    useful when your nameformat like 'YYYY/MM/DD/[info.log]'.
 * return {StrategyManager}
 */
module.exports = function createStream(options) {
  return new StrategyManager(options);
};

function StrategyManager(options) {
  if (!(this instanceof StrategyManager)) {
    return new StrategyManager(options);
  }
  options = options || {};
  this.level = options.level && options.level.toLowerCase() || 'info';
  // 记录上次刷新缓存的时间
  this.lastFlushTimeStamp = Date.now();
  // 标记当前使用的缓冲
  this.currentBuffer = 'A';
  // 日志的路径
  this.logdir = options.logdir;
  // 是否针对文件进行分片
  this.rollingFile = options.rollingFile;
  // 日志名称，必须与rollingFile对应
  this.name = options.name;
  if (!this.rollingFile){
    if(!this.name){
      throw new TypeError('必须提供日志文件名称');
    }
  }

  // 日志分片的名称模式
  this.nameformat = options.nameformat || '[application-]YYYYMMDD[.log]';
  this.nameformat = this.nameformat.replace('{pid}', process.pid);
  this.nameformatReg = /^\[([^\[\]-]+?)-\]/i;
  // 日志分片间隔
  this.duration = options.duration || ONE_DAY;
  // must >= one minute
  if (this.duration < 60000) {
    this.duration = 60000;
  }
  this.encoding = (options.encoding || 'utf-8').toLowerCase();
  if (this.encoding === 'utf8') {
    this.encoding = 'utf-8';
  }

  this.streamMode = options.mode || '0666';
  this.mkdir = options.mkdir;

  if (!this.rollingFile) {
    this.init();
  } else {
    // 针对rollingFile模式，仍采用单缓冲
    this.buf = [];
    this.flushTimeout = options.flushTimeout || DEFAULT_FLUSH_TIMOUT;
    this.flushTimer = setInterval(this._flush.bind(this), this.flushTimeout);

    // 初始化 日志删除任务
    // 由于delLogTask模块缓存，因此目前只能针对一个类型的日志分片做定时删除
    delLogTask.init({
      logdir: this.logdir
    });
    // flag: start 启动日志，创建或者使用已存在的log文件
    // flush: 非分片进程延迟10s执行写入
    this.cut('start');
    this.startTimer(this.firstDuration());
    return;
  }

  // 两个缓冲区，放弃数组结构，采用对象链表
  this._bufA = {};
  this._bufB = {};
  // 两个链表指针
  this._pA = this._bufA;
  this._pB = this._bufB;

  this._bufA.cacheSize = this._bufB.cacheSize = 0;

  // 每个缓冲的最大容量，超过该值则强制刷新
  this.cacheSize = options.cacheSize;
  // 强制刷新缓冲的时间
  this.flushTimeout = options.flushTimeout;
}

util.inherits(StrategyManager, EventEmitter);

StrategyManager.prototype.firstDuration = function () {
  var firstDuration = this.duration;
  if (this.duration > ONE_MINUTE) {
    var now = moment();
    if (this.duration < ONE_HOUR) { // in minute
      firstDuration = now.clone().add(this.duration, 'ms').startOf('minute').diff(now);
    } else if (this.duration < ONE_DAY) { // in hour
      firstDuration = now.clone().add(this.duration, 'ms').startOf('hour').diff(now);
    } else { // in day
      firstDuration = now.clone().add(this.duration, 'ms').startOf('day').diff(now);
    }
  }
  return firstDuration;
};

StrategyManager.prototype.startTimer = function (duration) {
  this._timer = setTimeout(function (self) {
    self.cut();
    delLogTask.run(function(error){
      if(error){
        return console.warn(`定时删除日志任务出错\n, ${error.message}: \n${error.stack}`);
      }
    });
    self.startTimer(self.duration);
  }, duration || this.duration, this);
};

// 针对非RollingFile，做初始化
StrategyManager.prototype.init = function () {
  var self = this;
  var name = this.name;
  var logpath = path.join(this.logdir, name);

  // make sure dir exist
  if (this.mkdir) {
    try {
      mkdirp.sync(path.dirname(logpath));
    } catch (err) {
      // ignore
    }
  }

  this._reopening = true;
  this.stream = fs.createWriteStream(logpath, {
    flags: 'a',
    mode: this.streamMode,
    // 设置10Mb的写缓冲
    highWaterMark: 10 * 1024 * 1024
  });
  this.stream
    .on("error", this.emit.bind(this, "error"))
    .on("pipe", this.emit.bind(this, "pipe"))
    .on("open", function () {
      this._reopening = false;
    }.bind(this))
    .on("close", function () {
      if (!this._reopening) {
        this.emit("close");
      }
    }.bind(this));

  this.stream.on('drain',function(){
    var temp = {};
    // 若此时writeable的写缓冲WriteReq链表已刷新完毕，则开始刷新另一个区的缓冲，此时
    // 需先针对之前缓冲的剩下链表做前向拼接
    self.cursor = self.continueBufferList;
    temp.next = self.cursor;
    self.cursor = temp;

    if(self.whichBufferFull == 'A'){
      self.whichBufferFull == undefined;
      self.tailCursor.next = self._bufB.next;
      //重新连接_bufB的链表，表头是A区剩下的链表，表尾是全部的B区
      self._bufB = self.cursor;
      self.flush('B');
    }else{
      self.whichBufferFull == undefined;
      self.tailCursor.next = self._bufA.next;
      self._bufA = self.cursor;
      self.flush('A');
    }
  });

  // 真正的刷新操作
  // 标示哪个缓冲区已满，若A区已满，则不论B区是否容量已超必须接受请求，直至A去缓存刷出
  this.doFlush = function(bufferName,cursor){
    var temp;
    // 遍历链表
    do{
      temp = cursor;
      cursor = cursor.next;
      temp.next = undefined;
      temp = null;
      //  self.stream.write(cursor)
      if(self.stream.write(cursor) === false){
        self.whichBufferFull = bufferName;
        self.continueBufferList = cursor.next;
        return;
      }
    }while(cursor.next !== undefined);
  };
};

// 当天的日志为 application.log,昨天的日志为 application-20180523.log
StrategyManager.prototype.cut = function (flag) {
//  var name = moment().format(this.nameformat);
  var self = this;
  var name = this.nameformat.match(this.nameformatReg)[1];
  // /home/www/logs/application.log
  var logpath = path.join(this.logdir, name + '.log');
  if (this.stream) {
    this._flush();
    this.stream.end();
  }

  if(!isSelectedWorker && !flag){
    this.stream = {
      datas: [],
      write: function(data){
        this.datas.push(data);
      },
      end: function(){
      },
      on: function(){}
    };
    setTimeout(()=>{
      // 非操作进程延迟10s重新写入内容至info.log，等待 分片进程分片完成
      this.cut('flush');
    },SHARDING_WAIT);
    return;
  }

  // 多进程问题存在竞争
  if(isSelectedWorker && !flag){
    // 使用level对应的write进行分片
    if(fs.existsSync(logpath) && this.level == 'info'){
      // let stats = fs.statSync(logpath);
      // let logDay = moment(stats.mtime).format(this.nameformat);
      let logDay = moment().subtract(1,'day').format(this.nameformat);
      // 重命名日志
      try{
        // 如果已存在分片后的文件，则不进行分片
        if(!fs.existsSync(path.join(this.logdir, logDay))){
          delLogTask.record(`${process.env.NODE_APP_INSTANCE}号进程[${process.pid} ${this.level}]即将进行分片重命名，文件名为${path.join(self.logdir, logDay)}`);
          fs.renameSync(logpath,path.join(this.logdir,logDay));
        }else{
          delLogTask.record(`${process.env.NODE_APP_INSTANCE}号进程[${process.pid} ${this.level}]检测文件名为${path.join(self.logdir, logDay)}已存在`);
        }
      }catch(e){
        delLogTask.record(`midlog重命名日志出错，${e.stack}`,'error');
      }
    }
  }else{
    // 非操作进程则重新等待刷新
  }
  
  // make sure dir exist
  if (this.mkdir) {
    try {
      mkdirp.sync(path.dirname(logpath));
    } catch (err) {
      // ignore
    }
  }

  let datas = this.stream && this.stream.datas;
  this.stream = fs.createWriteStream(logpath, {
    flags: 'a',
    mode: this.streamMode,
    highWaterMark: 10 * 1024 * 1024
  });
  this._reopening = true;
  this.stream
    .on("error", this.emit.bind(this, "error"))
    .on("pipe", this.emit.bind(this, "pipe"))
    .on("open", function () {
      this._reopening = false;
    }.bind(this))
    .on("close", function () {
      if (!this._reopening) {
        this.emit("close");
      }
    }.bind(this));
  // 如果为延时10s的非分片进程，则此时需要将缓冲从内存中刷新至info.log中  
  if(flag == 'flush'){
    this.stream.write(datas && datas.join('\n'));
  }  
};

StrategyManager.prototype.write = function (string) {
  if(this.rollingFile){
    this.buf.push(string);
  }else{
    let chunk = this._encode(string),
      now = Date.now();
    if (this.currentBuffer == 'A') {
      this._pA.next = chunk;
      this._pA = chunk;
      this._bufA.cacheSize += Buffer.byteLength(chunk,this.encoding);
      if(this.whichBufferFull == 'B'){
        return;
      }else if(this._bufA.cacheSize >= this.cacheSize || now - this.lastFlushTimeStamp >= this.flushTimeout){
        this.flush('A');
        this.lastFlushTimeStamp = Date.now();
      }
    }else{
      this._pB.next = chunk;
      this._pB = chunk;
      this._bufB.cacheSize += Buffer.byteLength(chunk,this.encoding);
      // A区正在刷缓冲，若此时writeable的写缓冲WriteReq已满，则B区必须接受所有请求
      if(this.whichBufferFull == 'A'){
        return;
      }else if(this._bufB.cacheSize >= this.cacheSize || now - this.lastFlushTimeStamp >= this.flushTimeout){
        this.flush('B');
        this.lastFlushTimeStamp = Date.now();
      }
    }
  }

};

StrategyManager.prototype.flush =
  StrategyManager.prototype._flush = function (bufferName) {
    if(this.rollingFile){
      if (this.buf.length) {
        var buf = this._encode(this.buf.join(''));
        this.stream.write(buf);
        this.buf.length = 0;
      }
      return;
    }
    // 会存在一种情况，即在高并发下一部分数据始终存在_bufA或_bufB底端无法刷新，
    // 这部分数据只有等到系统处理完双缓冲才能解决，因此采用链表结构仅需更新头部指针即可
    switch(bufferName){
      // 高并发下，真正的内存瓶颈在于writeable.write操作。chunk链表上的所有数据都堆积在
      // writable的WriteReq链表上，导致内存溢出
      case 'A':
        this.cursor = this._bufA;
        this.tailCursor = this._pA;
        this.currentBuffer = 'B';
        // 重置缓冲区
        this._bufA = {};
        this._pA = this._bufA;
        this._bufA.cacheSize = 0;

        this.doFlush('A',this.cursor);

        break;
      case 'B':
        this.cursor = this._bufB;
        this.tailCursor = this._pB;
        this.currentBuffer = 'A';
        this._bufB = {};
        this._pB = this._bufB;
        this._bufB.cacheSize = 0;

        this.doFlush('B',this.cursor);
        // 遍历链表
        /*do{
          temp = cursor;
          cursor = cursor.next;
          temp.next = undefined;
          temp = null;
          self.stream.write(cursor);
        }while(cursor.next !== undefined);*/
        /*
        this._bufB.forEach(function(buf){
          self.stream.write(buf);
        });
        this._bufB = [];
        this._bufB.cacheSize = 0;
        this.currentBuffer = 'A';*/
        break;
    }
  };

StrategyManager.prototype._encode = function (string) {
  if (this.encoding === 'utf-8') {
    return new Buffer(string);
  }
  return Buffer.from(string, this.encoding);
};

StrategyManager.prototype.end = function () {
  if (this._timer) {
    clearTimeout(this._timer);
    this._timer = null;
  }

  if (this.flushTimer) {
    clearInterval(this.flushTimer);
    this.flushTimer = null;
  }


  if (this.stream) {
    if(this.currentBuffer == 'A'){
      this._flush('A');
      this._flush('B');
    }else{
      this._flush('B');
      this._flush('A');
    }

    this.stream.end();
    this.stream = null;
  }
};

StrategyManager.prototype.close = StrategyManager.prototype.end;

module.exports.StrategyManager = StrategyManager;
