# 行程地图

页面：https://iicpcw.github.io/rail-atlas/
代码：https://github.com/iicpcw/rail-atlas
公共数据：https://github.com/iicpcw/rail-atlas-data

## 使用

运行 `python launch.py`，或在 Windows 双击 start.cmd。通过本地 HTTP 服务打开，不能直接双击 HTML。

支持 XLS/XLSX 多工作表导入、合并多个年份、勾选生成、日历筛选与手动添加行程。手动填写可选择仅添加或添加并生成。

- 中国国铁：出发日期、车次、精确起终站名必填。
- 日本铁路：出发日期、精确起终站名必填，不要求车次或选择运营方。
- 航空：起终机场三字码、航班号必填，日期可空。跨时区航班建议填写到达日期。

日期从单元格或年度 Sheet 识别；日历覆盖跨日行程。生成按钮作用于全部已导入年份；日历控制展示。生成失败的记录集中置顶。取消勾选隐藏轨迹。

铁路为红色半透明线，航空为 1.5px 黄色半透明线并绘制在铁路下方；机场和车站均为半径 4px 实心圆点。PC 侧栏可收起，支持 GeoJSON 与 1920×1280 PNG 分享图片。分享图片在本机生成。

## 铁路路径

优先读取静态国铁站点坐标，缺失再查询 OpenRailwayMap；当前坐标索引覆盖 5,418 个站名。站名匹配包含 OSM 历史名称、别名和铁路网络信息。

中国铁路按出发日期和车次读取历史停站表，再沿现有 OSM 铁路生成。历史快照不等于当天实际开行记录。旧线路按现有轨道匹配，不用公路或直线冒充铁路。

异常路径会自动尝试正反向寻路、备用铁路后端、跨相邻站匹配、站区多股道连通搜索、静态路网及扩大范围的实时路网查询。结果须通过停站、铁路标签、连接与里程校验后才采用；真实换向保留。公共接口或 OSM 数据仍可能缺失，无法通过校验的记录保留原因以便继续修复。

## 数据与隐私

时刻表大文件在独立数据仓库保存，应用按需读取；已停止全量历史后台下载。未缓存版本通过 RailLog 公开历史接口按需查询，成功结果在浏览器复用。网页部署不再抓取全量时刻表。

已有公开数据包含 82 份批量快照，历史补充 11,579 条记录（2019-06-28 完整快照 9,526 条；2019-08-15 部分记录 2,053 条），不是 2019 至今逐日全量数据库。

来源：RailRhythm12306（https://github.com/wj0575/RailRhythm12306）；Chinese Railway GTFS（Jeremy Gao，CC BY 4.0，https://github.com/wensimehrp/chinese-railway-gtfs）；RailLog（https://github.com/denglihong2007/RailLog）；OpenStreetMap contributors（ODbL，https://www.openstreetmap.org/copyright）。底图 OpenFreeMap，地形 Mapzen DEM。

表格在浏览器读取；外部接口仅收到查询所需站名、坐标、车次及版本。访客计数使用不蒜子，不上传行程表。刷新前请导出需要保留的轨迹。

## 开发

修改后运行 `node scripts/build.mjs`，执行 tests 下的 Node 测试及 `node test-generation.cjs`。GitHub Actions 校验并部署 dist。只发布 index.html 引用的版本化 bundle，不发布本地 QA 页面、用户表格或下载临时文件。

生成性能：最多两条独立行程并行处理；同一取消范围内相同 GET 请求合并；经过校验的本地路网优先于远程寻路。公共接口仍按主机排队和限速，403/429 冷却保持有效。
