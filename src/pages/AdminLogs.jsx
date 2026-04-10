import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/entities';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { RefreshCw, ChevronLeft, ChevronRight, AlertCircle, Lock } from 'lucide-react';

const ITEMS_PER_PAGE = 25;

const levelColors = {
    error: 'bg-red-100 text-red-800',
    warn: 'bg-yellow-100 text-yellow-800',
    info: 'bg-blue-100 text-blue-800',
    debug: 'bg-gray-100 text-gray-700',
};

const categoryColors = {
    frontend: 'bg-purple-100 text-purple-800',
    backend: 'bg-indigo-100 text-indigo-800',
    database: 'bg-green-100 text-green-800',
    integration: 'bg-orange-100 text-orange-800',
};

export default function AdminLogs() {
    const driverRole = localStorage.getItem('miller_driver_role');

    const [levelFilter, setLevelFilter] = useState('all');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [selectedLog, setSelectedLog] = useState(null);

    const { data: logs = [], isLoading, refetch, isFetching } = useQuery({
        queryKey: ['log-entries'],
        queryFn: () => base44.entities.LogEntry.list('-created_date', 5000),
        enabled: driverRole === 'admin',
        refetchInterval: 30000,
    });

    if (driverRole !== 'admin') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center p-8">
                    <Lock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">Access Denied</h2>
                    <p className="text-gray-500">You need admin privileges to view system logs.</p>
                </div>
            </div>
        );
    }

    const filtered = logs.filter(log => {
        if (levelFilter !== 'all' && log.level !== levelFilter) return false;
        if (categoryFilter !== 'all' && log.category !== categoryFilter) return false;
        if (search && !log.message?.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
    const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

    const errorCount = logs.filter(l => l.level === 'error').length;
    const warnCount = logs.filter(l => l.level === 'warn').length;

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">System Logs</h1>
                    <p className="text-sm text-gray-500">{filtered.length} of {logs.length} entries shown</p>
                </div>
                <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-2">
                    <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-xl border p-4">
                    <p className="text-xs text-gray-500 mb-1">Total Logs</p>
                    <p className="text-2xl font-bold text-gray-800">{logs.length}</p>
                </div>
                <div className="bg-red-50 rounded-xl border border-red-100 p-4">
                    <p className="text-xs text-red-500 mb-1">Errors</p>
                    <p className="text-2xl font-bold text-red-700">{errorCount}</p>
                </div>
                <div className="bg-yellow-50 rounded-xl border border-yellow-100 p-4">
                    <p className="text-xs text-yellow-600 mb-1">Warnings</p>
                    <p className="text-2xl font-bold text-yellow-700">{warnCount}</p>
                </div>
                <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
                    <p className="text-xs text-blue-500 mb-1">Info / Debug</p>
                    <p className="text-2xl font-bold text-blue-700">{logs.length - errorCount - warnCount}</p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-4">
                <Input
                    placeholder="Search messages..."
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                    className="w-56"
                />
                <Select value={levelFilter} onValueChange={v => { setLevelFilter(v); setPage(1); }}>
                    <SelectTrigger className="w-36">
                        <SelectValue placeholder="Level" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Levels</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                        <SelectItem value="warn">Warning</SelectItem>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="debug">Debug</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={categoryFilter} onValueChange={v => { setCategoryFilter(v); setPage(1); }}>
                    <SelectTrigger className="w-40">
                        <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        <SelectItem value="frontend">Frontend</SelectItem>
                        <SelectItem value="backend">Backend</SelectItem>
                        <SelectItem value="database">Database</SelectItem>
                        <SelectItem value="integration">Integration</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border overflow-hidden">
                {isLoading ? (
                    <div className="p-10 text-center text-gray-400">Loading logs...</div>
                ) : paginated.length === 0 ? (
                    <div className="p-10 text-center text-gray-400">
                        <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p>No logs found</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Timestamp</th>
                                    <th className="text-left px-4 py-3 font-medium text-gray-600">Level</th>
                                    <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                                    <th className="text-left px-4 py-3 font-medium text-gray-600">Message</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginated.map((log, i) => (
                                    <tr
                                        key={log.id}
                                        onClick={() => setSelectedLog(log)}
                                        className={`border-b cursor-pointer hover:bg-amber-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}
                                    >
                                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap font-mono text-xs">
                                            {log.timestamp ? format(new Date(log.timestamp), 'MMM d, HH:mm:ss') : '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge className={levelColors[log.level] || 'bg-gray-100 text-gray-700'}>
                                                {log.level}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge className={categoryColors[log.category] || 'bg-gray-100 text-gray-700'}>
                                                {log.category}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-gray-800 max-w-md truncate">
                                            {log.message}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Detail Dialog */}
            <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Badge className={levelColors[selectedLog?.level]}>
                                {selectedLog?.level}
                            </Badge>
                            Log Entry Detail
                        </DialogTitle>
                    </DialogHeader>
                    {selectedLog && (
                        <div className="space-y-4 text-sm">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-gray-500 font-medium mb-1">Timestamp</p>
                                    <p className="font-mono text-xs">
                                        {selectedLog.timestamp ? format(new Date(selectedLog.timestamp), 'MMM d, yyyy HH:mm:ss') : '—'}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-gray-500 font-medium mb-1">Category</p>
                                    <Badge className={categoryColors[selectedLog.category]}>{selectedLog.category}</Badge>
                                </div>
                                {selectedLog.userId && (
                                    <div className="col-span-2">
                                        <p className="text-gray-500 font-medium mb-1">User ID</p>
                                        <p className="font-mono text-xs bg-gray-50 rounded p-2">{selectedLog.userId}</p>
                                    </div>
                                )}
                            </div>
                            <div>
                                <p className="text-gray-500 font-medium mb-1">Message</p>
                                <p className="bg-gray-50 rounded p-3">{selectedLog.message}</p>
                            </div>
                            {selectedLog.details && (
                                <div>
                                    <p className="text-gray-500 font-medium mb-1">Details</p>
                                    <pre className="bg-gray-900 text-green-400 rounded p-3 text-xs overflow-x-auto whitespace-pre-wrap max-h-64">
                                        {JSON.stringify(selectedLog.details, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}