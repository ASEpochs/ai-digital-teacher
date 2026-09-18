import { ArrowLeft, ArrowUpRight, Download, History, Search } from 'lucide-react'
import { useState } from 'react'
import { downloadJson, formatDate, formatTime, reportEvents, type ArchivedClass } from '../platform'
import { EmptyState } from './ui'
import { ReportView } from './Analysis'

export function HistoryPage({ records, goLive }: { records: ArchivedClass[]; goLive: () => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const record = records.find(r => r.id === selected)
  const filtered = records.filter(r => `${r.context.classroom} ${r.context.course} ${r.context.observer}`.includes(query.trim()))
  if (record) return <><div className="history-detail-heading"><button className="button" onClick={() => setSelected(null)}><ArrowLeft size={16} />返回历史课堂</button><span>{record.context.classroom} · {record.context.course} · {formatDate(record.startedAt)}</span></div><ReportView report={record.report} /></>
  return <><div className="info-strip"><History size={18} /><span>保存当前浏览器最近 30 次已结束课堂的报告。清理浏览器数据会移除记录，暂不支持跨设备同步。</span></div><section className="panel"><div className="list-toolbar"><label className="search-field"><Search size={16} /><input aria-label="搜索历史课堂" placeholder="搜索课堂、课程或观察员" value={query} onChange={e => setQuery(e.target.value)} /></label><button className="button" disabled={!records.length} onClick={() => downloadJson('课堂历史记录.json', records)}><Download size={15} />导出全部</button></div>{filtered.length ? <div className="table-scroll"><table><thead><tr><th>课堂 / 课程</th><th>开始时间</th><th>观察时长</th><th>分析画面</th><th>异常事件</th><th>报告</th></tr></thead><tbody>{filtered.map(row => <tr key={row.id}><td><strong>{row.context.classroom}</strong><small>{row.context.course} · {row.context.observer}</small></td><td>{formatDate(row.startedAt)}</td><td className="mono">{formatTime(row.elapsed)}</td><td>{row.sampleCount} 次</td><td>{reportEvents(row.report).filter(e => e.severity !== 'info').length} 项</td><td><button className="text-button" onClick={() => setSelected(row.id)}>查看报告<ArrowUpRight size={15} /></button></td></tr>)}</tbody></table></div> : <EmptyState title={records.length ? '未找到匹配课堂' : '留住每一次课堂观察'} text={records.length ? '请尝试其他关键词。' : '完成课堂观察后，报告会自动存入这里，便于回看与导出。'} action={!records.length && <button className="button primary" onClick={goLive}>开始第一次观察</button>} />}</section></>
}
