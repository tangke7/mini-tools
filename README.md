## Mini Tools

一个本地轻量工具集合，目前包含 JSON 格式化、SQL 格式化等前端工具。

### 环境要求

- Node.js 14 或更高版本
- npm
- macOS / Linux / Windows 均可运行

### 安装依赖

```bash
npm install
```

### 本地开发

```bash
npm run dev
```

### 构建项目

```bash
npm run build
```

构建产物会生成到 `dist` 目录。

### 浏览器插件打包

如果需要将项目打包成浏览器插件，可以执行：

```bash
npm run extension:build
```

该命令会先执行生产构建，然后将 `dist` 目录打包成浏览器插件压缩包。

打包完成后会生成：

- `dist`：可直接加载的插件目录
- `mini-tools-extension.zip`：可分发的插件压缩包

本地调试插件时，可以在 Chrome / Edge 扩展管理页开启“开发者模式”，选择“加载已解压的扩展程序”，然后选择项目下的 `dist` 目录。

### 一键启动服务

```bash
npm run service:start
```

该命令会先执行生产构建，然后通过 `PM2` 在后台启动服务。

默认访问地址：

```text
http://localhost:3888
```

局域网内其他设备可通过当前电脑的局域网 IP 访问，例如：

```text
http://你的电脑IP:3888
```

### 一键停止服务

```bash
npm run service:stop
```

### 一键重启服务

```bash
npm run service:restart
```

该命令会重新构建项目，并重启后台服务。如果服务尚未启动，会自动启动服务。

### 查看服务状态

```bash
npm run service:status
```

### 查看服务日志

```bash
npm run service:logs
```

### 删除后台服务

如果不再需要 `PM2` 管理该服务，可以执行：

```bash
npm run service:delete
```

### 设置开机自启动

首次启动服务后，执行：

```bash
npm run service:startup
```

`PM2` 会输出一条需要复制执行的系统命令。请按照终端提示复制并执行该命令。

然后保存当前服务列表：

```bash
npm run service:save
```

完成后，电脑重启时会自动恢复 `mini-tools` 服务。

### 取消开机自启动

如果后续不想开机自动启动，可以先删除服务并保存当前 `PM2` 列表：

```bash
npm run service:delete
npm run service:save
```

如需彻底移除 `PM2` 的系统自启动配置，可以执行 `pm2 unstartup`，并按照终端提示操作。

### 端口配置

服务默认端口为 `3888`。

如果需要修改端口，请编辑 `ecosystem.config.cjs` 中的启动参数：

```js
args: '-s dist -l tcp://0.0.0.0:3888',
```

将 `3888` 改成你想使用的端口即可。
