var moment = require('moment');
var fs = require('fs');
var path = require('path');
var now = moment().add(0, 'day');
console.log(now)
var files = fs.readdirSync(path.join(__dirname,'files'));
var patt = /^(?:application|info)-(\d{8})\.log$/;

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

console.log(logs)