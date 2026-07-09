/*
 * Copyright (c) 2026 MyCompany LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { formatDistanceToNow } from 'date-fns'

interface EgressHistory {
  date: string
  bytes: number
}

interface EgressBreakdown {
  type: string
  bytes: number
}

interface OfflineDevice {
  id: string
  name: string
  lastSeen: string | null
  teamName: string
}

interface SystemLog {
  id: string
  deviceId: string
  deviceName: string
  teamName: string
  level: 'info' | 'warn' | 'error'
  message: string
  createdAt: string
}

interface SystemStats {
  egress: {
    total: number
    last24h: number
    breakdown: EgressBreakdown[]
    history: EgressHistory[]
  }
  devices: {
    counts: {
      ONLINE: number
      OFFLINE: number
      WARNING: number
    }
    offline: OfflineDevice[]
  }
  logs: {
    errorCount: number
    warnCount: number
    recent: SystemLog[]
  }
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export default function System() {
  const qc = useQueryClient()
  const [filterLevel, setFilterLevel] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [clearDays, setClearDays] = useState<string>('30')

  // Fetch metrics and logs
  const { data: stats, isLoading, refetch } = useQuery<SystemStats>({
    queryKey: ['system-stats'],
    queryFn: () => api.get('/system/stats').then(r => r.data),
    refetchInterval: 15_000,
  })

  // Mutation to purge logs
  const clearLogs = useMutation({
    mutationFn: (days: number | null) => api.post('/system/logs/clear', { days }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['system-stats'] })
      toast.success(`Successfully cleared ${data.data.count} log records`)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to purge logs')
    }
  })

  const handleClearLogs = () => {
    const daysLabel = clearDays === 'all' ? 'all logs' : `logs older than ${clearDays} days`
    if (confirm(`Are you sure you want to permanently delete ${daysLabel}?`)) {
      const daysParam = clearDays === 'all' ? null : parseInt(clearDays, 10)
      clearLogs.mutate(daysParam)
    }
  }

  // Filter logs locally based on level and search query
  const filteredLogs = useMemo(() => {
    if (!stats?.logs?.recent) return []
    return stats.logs.recent.filter(log => {
      const matchesLevel = filterLevel === 'all' || log.level === filterLevel
      const matchesSearch = 
        log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.deviceName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.teamName.toLowerCase().includes(searchQuery.toLowerCase())
      return matchesLevel && matchesSearch
    })
  }, [stats?.logs?.recent, filterLevel, searchQuery])

  // Max egress bytes to scale the bar chart
  const maxEgressBytes = useMemo(() => {
    if (!stats?.egress?.history) return 1
    const max = Math.max(...stats.egress.history.map(h => h.bytes))
    return max > 0 ? max : 1
  }, [stats?.egress?.history])

  if (isLoading || !stats) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen bg-base">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-teal border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-txt-secondary">Loading system diagnostics...</p>
        </div>
      </div>
    )
  }

  const totalDevices = stats.devices.counts.ONLINE + stats.devices.counts.OFFLINE + stats.devices.counts.WARNING

  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-6">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-txt-primary">System Admin</h1>
          <p className="text-xs text-txt-secondary mt-1">
            Global network egress tracking, system health, and hardware warning feeds.
          </p>
        </div>
        <button 
          onClick={() => { refetch(); toast.success('Diagnostics updated') }}
          className="btn-ghost flex items-center gap-1.5 border border-border"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89H18" />
          </svg>
          Refresh Feed
        </button>
      </div>

      {/* Grid Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        {/* Total Egress */}
        <div className="card flex items-center justify-between">
          <div>
            <p className="text-xs text-txt-secondary uppercase tracking-wider font-semibold">Total Data Egress</p>
            <h3 className="text-2xl font-bold text-txt-primary mt-1">{formatBytes(stats.egress.total)}</h3>
            <p className="text-[10px] text-txt-secondary mt-0.5">Cumulative static server traffic</p>
          </div>
          <div className="p-3 bg-teal-glow text-teal rounded-lg">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
          </div>
        </div>

        {/* Egress 24h */}
        <div className="card flex items-center justify-between">
          <div>
            <p className="text-xs text-txt-secondary uppercase tracking-wider font-semibold">Egress (Last 24h)</p>
            <h3 className="text-2xl font-bold text-txt-primary mt-1">{formatBytes(stats.egress.last24h)}</h3>
            <p className="text-[10px] text-txt-secondary mt-0.5">Media updates and slide downloads</p>
          </div>
          <div className="p-3 bg-teal-glow text-teal rounded-lg">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
        </div>

        {/* Online Devices Ratio */}
        <div className="card flex items-center justify-between">
          <div>
            <p className="text-xs text-txt-secondary uppercase tracking-wider font-semibold">System Hardware Health</p>
            <h3 className="text-2xl font-bold text-txt-primary mt-1">
              {stats.devices.counts.ONLINE} <span className="text-xs text-txt-secondary font-normal">/ {totalDevices} Online</span>
            </h3>
            <p className="text-[10px] text-txt-secondary mt-0.5">
              {stats.devices.counts.OFFLINE} offline · {stats.devices.counts.WARNING} warning states
            </p>
          </div>
          <div className={`p-3 rounded-lg ${stats.devices.counts.OFFLINE > 0 ? 'bg-coral-glow text-coral' : 'bg-teal-glow text-teal'}`}>
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        {/* Global Error Count */}
        <div className="card flex items-center justify-between">
          <div>
            <p className="text-xs text-txt-secondary uppercase tracking-wider font-semibold">Global Failure Logs</p>
            <h3 className="text-2xl font-bold text-coral mt-1">
              {stats.logs.errorCount} <span className="text-xs text-txt-secondary font-normal">Errors</span>
            </h3>
            <p className="text-[10px] text-amber mt-0.5">
              {stats.logs.warnCount} warnings registered
            </p>
          </div>
          <div className="p-3 bg-coral-glow text-coral rounded-lg">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        </div>

      </div>

      {/* Main Split Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Daily Egress Chart (Span 2) */}
        <section className="card lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h2 className="text-sm font-bold text-txt-primary">Network Data Transfer</h2>
              <p className="text-[11px] text-txt-secondary">Daily bytes served over the last 7 days</p>
            </div>
            <div className="flex gap-4 text-xs font-mono">
              {stats.egress.breakdown.map((item: any) => (
                <div key={item.type} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${item.type === 'SCREENSHOT' ? 'bg-amber' : 'bg-teal'}`} />
                  <span className="text-txt-secondary">{item.type}:</span>
                  <span className="text-txt-primary">{formatBytes(item.bytes)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Interactive CSS Bar Chart */}
          <div className="flex items-end justify-between gap-3 h-48 px-2 pt-6">
            {stats.egress.history.map((day) => {
              const heightPercent = maxEgressBytes > 0 ? (day.bytes / maxEgressBytes) * 100 : 0
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center group relative">
                  
                  {/* Floating Tooltip */}
                  <div className="absolute bottom-full mb-2 bg-surface border border-border text-[10px] font-mono px-2 py-1 rounded hidden group-hover:block whitespace-nowrap z-10 shadow-lg">
                    <p className="font-semibold text-txt-primary">{formatBytes(day.bytes)}</p>
                    <p className="text-txt-muted text-[8px]">{day.date}</p>
                  </div>
                  
                  {/* Bar */}
                  <div 
                    className="w-full bg-teal/20 group-hover:bg-teal/40 border border-teal/30 hover:border-teal rounded-t transition-all duration-200"
                    style={{ height: `${Math.max(4, heightPercent)}%` }}
                  />
                  
                  {/* Label */}
                  <span className="text-[10px] text-txt-secondary font-mono mt-2.5">
                    {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' })}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        {/* System Operations & Maintenance (Span 1) */}
        <section className="card space-y-4">
          <div className="border-b border-border pb-3">
            <h2 className="text-sm font-bold text-txt-primary">Log Maintenance</h2>
            <p className="text-[11px] text-txt-secondary">Prevent database storage issues</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-xs text-txt-secondary">Select purge threshold:</label>
              <select 
                value={clearDays}
                onChange={(e) => setClearDays(e.target.value)}
                className="input py-1.5 focus:border-coral bg-surface"
              >
                <option value="7">Purge logs older than 7 days</option>
                <option value="30">Purge logs older than 30 days</option>
                <option value="90">Purge logs older than 90 days</option>
                <option value="all">Purge ALL logs in database</option>
              </select>
            </div>
            
            <button 
              onClick={handleClearLogs}
              disabled={clearLogs.isPending}
              className="w-full py-2 bg-coral text-base font-semibold rounded-lg hover:bg-coral-dim disabled:opacity-50 transition-colors text-xs flex items-center justify-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {clearLogs.isPending ? 'Purging logs...' : 'Execute Log Purge'}
            </button>
          </div>

          {/* Offline Devices Mini Feed */}
          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-bold text-txt-primary">Critical Offline List</h3>
            {stats.devices.offline.length === 0 ? (
              <p className="text-[10px] text-txt-secondary">All displays are currently online or warnings cleared.</p>
            ) : (
              <div className="max-h-24 overflow-y-auto space-y-1.5 pr-1">
                {stats.devices.offline.map(d => (
                  <div key={d.id} className="flex justify-between items-center text-[10px] bg-surface p-1.5 rounded border border-border">
                    <span className="font-semibold text-txt-primary truncate max-w-[100px]" title={d.name}>{d.name}</span>
                    <span className="text-txt-muted truncate max-w-[80px]" title={d.teamName}>{d.teamName}</span>
                    <span className="text-coral">
                      {d.lastSeen ? `${formatDistanceToNow(new Date(d.lastSeen))} ago` : 'never'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

      </div>

      {/* Central Error Feed Section */}
      <section className="card space-y-4">
        
        {/* Filters bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-bold text-txt-primary">Global Error & Warning Feed</h2>
            <p className="text-[11px] text-txt-secondary">Real-time issues streaming across all connected digital displays</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            
            {/* Search */}
            <div className="relative">
              <input 
                type="text"
                placeholder="Search logs, devices, teams..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input py-1.5 pl-8 text-xs w-48 focus:border-teal"
              />
              <svg className="w-3.5 h-3.5 text-txt-secondary absolute left-2.5 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            {/* Filter select */}
            <select
              value={filterLevel}
              onChange={(e) => setFilterLevel(e.target.value)}
              className="input py-1.5 text-xs w-36 bg-surface focus:border-teal"
            >
              <option value="all">All Severity Levels</option>
              <option value="error">Errors Only</option>
              <option value="warn">Warnings Only</option>
            </select>

          </div>
        </div>

        {/* Logs Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-txt-secondary uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3">Device / Organization</th>
                <th className="py-2.5 px-3 w-20">Severity</th>
                <th className="py-2.5 px-3">Log Message</th>
                <th className="py-2.5 px-3 w-32 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-txt-muted">
                    No matching warning or error records found.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-surface/30 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-semibold text-txt-primary">{log.deviceName}</div>
                      <div className="text-[10px] text-txt-secondary">{log.teamName}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`inline-block text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                        log.level === 'error' ? 'bg-coral-glow text-coral' : 'bg-amber-glow text-amber'
                      }`}>
                        {log.level}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-txt-primary font-mono text-[11px] max-w-xl break-all">
                      {log.message}
                    </td>
                    <td className="py-3 px-3 text-right text-txt-secondary font-mono text-[10px]">
                      {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

    </main>
  )
}
