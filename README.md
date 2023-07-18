# 高性能koa日志中间件

## 快速使用

在Rocker-MVC框架下：

start.js
```
import { Inject, Interfaces, Container} from "@vdian/rocker";
import { MVC } from "@vdian/rocker-mvc";
import {init, Logger} from '@vdian/commons';
import { MidLog } from '@vdian/midlog';

// 配置日志级别和输出路径
// 其中，appender的属性application为业务日志配置项，必须提供三种级别“info，warn，error”的配置;
// appender的其他属性，如rpc、redis、mysql配置中间件的日志输出，中间件的输出只需提供“输出路径和文件名”即可，不需要提供级别！！！
MidLog.config({
  // env为 “dev”,则输出到命令行窗口
  // env为 非“dev”，则输出到文件
  env: 'online',
  // 获取traceid
  vtrace: ()=>{
    if(Threadlocal.context && Threadlocal.context.request && Threadlocal.context.request.header){
        return Threadlocal.context.request.header['HTTP_X_TRACE_ID'];
    }
  },
  // 业务日志信息配置
  appender: [{
        type: 'TRACE',
        rollingFile: true,
        logdir: '/home/www/logs',
        name: 'info.log'
    },{
        type: 'DEBUG',
        rollingFile: true,
        logdir: '/home/www/logs',
        name: 'info.log'
    },{
        type: 'INFO',
        rollingFile: true,
        logdir: '/home/www/logs',
        name: 'info.log'
    },{
        type: 'WARN',
        rollingFile: true,
        logdir: '/home/www/logs',
        name: 'info.log',
    },{
        type: 'ERROR',
        rollingFile: true,
        logdir: '/home/www/logs',
        name: 'info.log',
    },{
        type: 'FATAL',
        rollingFile: true,
        logdir: '/home/www/logs',
        name: 'info.log',
    }],
});

// 注入MidLog到容器内
init({
    Logger: () => {
        return new MidLog();
    }
});

// 必须在MidLog日志工具注入到容器后，才能引用中间件
// 否则，中间件内部依赖的日志工具（即MidLog）无法使用，因为还没有实例化
import  '@vdian/rpc';
import  '@vdian/redis';
import  '@vdian/mysql';
import  '@vdian/zk';
import  '@vdian/mq';

MVC.route({'/home': import('./router')}).start();
```

router.js
```
import {Get, Param, Request} from "@vdian/rocker-MVC";
import { Inject} from "@vdian/rocker";
import { Logger} from '@vdian/commons';
import SomeService from './test-service';

export default class {
    @Inject
    private service: SomeService;

    @Get({url: '/c', render: ['./tpt.ejs']})//for bigpipe
    async get(@Param('id') _id: string, @Request _ctx) {
        // 直接使用注入到 Common 类的logger对象即可
        Logger.error('123123123', new TypeError('类型错误'));
        let ts = await this.service.computeSomething(_id);
        Logger.info('56456456456');
        await new Promise((res,rej)=>{
            setTimeout(() => {
                res();
            }, 2000);
        });
        Logger.warn('789798798', new RangeError('数组越界'));
        return {name: ts};
    }
}
```

**使用时，必须注意MidLog实例被注入到容器的时机。因为许多中间件如rpc、redis、zk等都会在内部依赖日志接口（这个日志接口的实现不强制要求必须是midlog，也可以是其他的实现。但为了统一公司日志规范目前只能使用midlog），只要留意示例中的引用时序就可以在业务代码中通过引入 Common 类直接使用midlog工具**

由于公司针对服务端的日志输出格式以及路径有严格的规范，因此开发者也可以采用极简格式配置日志工具，仅需指出各级别日志输出名称即可(如果不显式指定文件名，则默认为“info.log”)：
```
MidLog.config({
    env: 'online',
    // 获取traceid
    vtrace: ()=>{
        if(Threadlocal.context && Threadlocal.context.request && Threadlocal.context.request.header){
            return Threadlocal.context.request.header['HTTP_X_TRACE_ID'];
        }
    },
    // 所有级别日志均输出到 "/home/www/logs/info.log"中，各级中间件则输出至 "/home/www/logs/${name}/info.log"中
    // 线上日志采用文件分片，以“一天”为单位，保留最近七天的文件
    appender:[{
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
        }],
  });
```

## 接口
import { Logger} from '@vdian/commons';

Logger.trace(data: any);

Logger.trace(data: any, error: Error);

Logger.debug(data: any);

Logger.debug(data: any, error: Error);

Logger.info(data: any);

Logger.info(data: any, error: Error);

Logger.warn(data: any);

Logger.warn(data: any, error: Error);

Logger.error(data: any);

Logger.error(data: any, error: Error);

Logger.fatal(data: any);

Logger.fatal(data: any, error: Error);


其中，第一个参数为任意类型，但必须提供 toString() 

## 功能

midlog提供了6种日志刷新级别：

  **TRACE、DEBUG、INFO、WARN、ERROR、FATAL**，

并且提供了两种写日志文件的方式：

- 单文件写 （通过设置appender的rollingFile为false触发）

- 文件分时间片写 （通过设置appender的rollingFile为true触发）

midlog采用和log4js相同的layout格式和语法，生成可定制的日志输出格式。

最后，midlog采用多级缓冲的架构（针对单文件写模式采用双缓冲，文件分时写模式采用单缓冲），可以有效的控制Stream写的频率，而缓冲的大小和刷新频率可以由开发者根据实际需要自由设置。

## 配置

- env {String} 环境设置。若设置为**development**，则会在控制台和文件中同时输出日志

- appender {Array} 日志类型配置数组。数组每一项描述每种类型日志的相关信息及缓冲刷新频率

## appender详解

- type {String} 日志类型。可以为 “INFO、TRACE和ERROR” 任意一种

- logdir {String} 日志文件所在的绝对目录

- rollingFile {Boolean} 是否按照时间进行日志文件分割。设置为true时则按照设置的**duration**间隔分割文件

- duration {Number} 分割日志文件的间隔。若**rollingFile**为true，则按照**duration**大小分割文件

- name {String} 日志文件名称。name属性在**单文件写**模式下有效，在**rollingFile == true**时无效

- nameformat {String} 日志文件格式匹配定义。nameformat属性在**文件分时间片写**模式下有效，即**rollingFile == true**
格式定义的字符串意义如下所示：
```
    'd': 日期和时间,
    'h': 主机名称,
    'm': 日志信息格式化，主要优化错误输出,
    'n': 换行符,
    'p': 日志级别,
    'r': 时间输出,
    'z': 进程号输出,
    '%': 百分号占位符,
    'x': 用户自定义变量或函数，搭配{token}属性
```

- tokens {Object} 与nameformat搭配使用，对象的属性值可为常亮，也可为函数

如定义nameformat为  `pattern: '%d %r %x{name}:%z %p - %m%n'` 且tokens设置为 `{name: 'helloworld'}`

则输出日志格式为：

```
           (%d)           (%r)   (%x{name}) (%z)  (%p)           (%m)               (%n)
2017-01-16 10:59:55.611 10:59:55 helloworld:13736 INFO - / this is the first valve!!
```

- cacheSize {Number} 缓冲大小，单位字节。midlog在**单文件写**模式下采用双缓冲结构控制I/O速率，因此开发者可以通过定义缓冲大小实现高效的写入流程，默认为10kB大小；在**文件分时间片写**模式下该选项无效

- flushTimeout {Number} 缓冲刷新间隔。在**单文件写**和**文件分时间片写**两种模式下都起作用，定点刷新缓冲