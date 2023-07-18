'use strict';

var fs = require('fs');
var path = require('path');
var moment = require('moment');
var mkdirp = require('mkdirp');
let LOGDIR = null;
let delLogDir = null;
let delLogWriter = null;

//获取用户目录
if (!process.env['HOME']) {
  LOGDIR = '/home/www/logs';
}else{
  LOGDIR = path.join(process.env['HOME'],'logs');
}

delLogDir = path.join(LOGDIR,'midlog/log_cleaner.log');
if(!fs.existsSync(path.dirname(delLogDir))){
  mkdirp.sync(path.dirname(delLogDir));
}
delLogWriter = fs.createWriteStream(delLogDir,{
  flags: 'a+'
});
delLogWriter.on('error', (err) => {
  console.log(`写入${delLogDir}发生异常:`, err);
});
delLogWriter.on('finish', () => {
  console.log(`写入${delLogDir}完成`); 
});
delLogWriter.on('close', () => {
  console.log(`${delLogDir}文件已关闭！`);
});

let infoLogDir = path.join(LOGDIR,'midlog/info.log');
let infoLogWriter = fs.createWriteStream(infoLogDir,{
  flags: 'a+'
});
infoLogWriter.on('error', (err) => {
  console.log(`写入${infoLogDir}发生异常:`, err);
});
infoLogWriter.on('finish', () => {
  console.log(`写入${infoLogDir}完成`); 
});
infoLogWriter.on('close', () => {
  console.log(`${infoLogDir}文件已关闭！`);
});

exports.record = function(msg,level){
  level = level ? level.toUpperCase() : 'INFO';
  infoLogWriter.write(`${moment().format('YYYY-MM-DD hh:mm:ss')} [${level}] ${msg}\n`);
};

exports.logdir = ''; // 日志路径

// 日志保留天数
var KEEP_DAYS = 7;

var pad2 = function (num) {
  if (num < 10) {
    return '0' + num;
  }
  return '' + num;
};
  
var getYYYYMMDD = function (date) {
  var YYYY = date.get('year');
  var MM = pad2(date.get('month') + 1);
  var DD = pad2(date.get('date'));
  return '' + YYYY + MM + DD;
};

var getYY = function (date) {
  var YYYY = date.get('year');
  return '' + YYYY;
}

var removeFiles = function (logdir, files, callback) {
  var count = files.length;
  if (count === 0) {
    return callback(null);
  }

  var done = function (err) {
    if (err) {
      return callback(err);
    }

    count--;
    if (count <= 0) {
      callback(null);
    }
  };

  for (var i = 0; i < files.length; i++) {
    var filename = files[i];
    var filepath = path.join(logdir, filename);
    delLogWriter.write(`[${moment().format('YYYY-MM-DD hh:mm:ss')}] delete log: ${filepath}\n`);
    if(fs.existsSync(filepath)){
      fs.unlink(filepath, done);
    }else{
      done();
    }
  }
};

var patt = /^(?:application|info)-(\d{8})\.log$/;

var cleanOldLogs = function (callback) {
  logDirs.length > 0 && logDirs.forEach((dir)=>{
    fs.readdir(dir, function (err, files) {
      if (err) {
        return callback(err);
      }
  
      // 防止时区问题
      var now = moment();
      var today = parseInt(getYYYYMMDD(now), 10);
      var logs = files.filter(function (filename) {
        var matched = filename.match(patt);
        if (matched) {
          var date = parseInt(matched[1]);
          // 保证在同一年份内判断
          if(matched[1].slice(0,4) == getYY(now)){
            if (date < today - KEEP_DAYS) {
              // 删除KEEP_DAYS天前的node/access日志
              return true;
            }
          }else{
            // 20190101 - 8876 = 20181225
            // 20190102 - 8876 = 20181226
            // 20190103 - 8876 = 20181227
            // 20190104 - 8876 = 20181228
            // 20190105 - 8876 = 20181229
            // 20190106 - 8876 = 20181230
            // 20190107 - 8876 = 20181231
            // 20190108 - 8876 = 20181232
            if(date < today - 8876){
              return true;
            }
          } 
        }
        return false;
      });
  
      removeFiles(dir, logs, callback);
    });
  });
};

let logDirs = [];
exports.init = function (config) {
  if(!logDirs.includes(config.logdir)){
    logDirs.push(config.logdir);
  }
};

exports.run = function (callback) {
  if (!logDirs) {
    return callback(new Error('Not specific logdir in midlog config file'));
  }

  cleanOldLogs(function (err) {
    if (err) {
      return callback(err);
    }

    // nothing to report
    callback(null);
  });
};

exports.reportInterval = 24 * 60 * 60 * 1000; // 1 day
