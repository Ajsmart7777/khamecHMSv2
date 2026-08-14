import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Search, 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight,
  AlertTriangle,
  Bug,
  ExternalLink,
  Download,
  Calendar
} from 'lucide-react';
import { format, startOfDay, endOfDay } from 'date-fns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Tables } from '@/integrations/supabase/types';
import { toast } from 'sonner';

type ErrorLog = Tables<'error_logs'>;

const ITEMS_PER_PAGE = 10;

export function ErrorLogsViewer() {
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [errorTypeFilter, setErrorTypeFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedLog, setSelectedLog] = useState<ErrorLog | null>(null);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('error_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (errorTypeFilter !== 'all') {
        query = query.eq('error_type', errorTypeFilter);
      }

      if (searchQuery) {
        query = query.or(`error_message.ilike.%${searchQuery}%,error_type.ilike.%${searchQuery}%`);
      }

      if (dateFrom) {
        query = query.gte('created_at', startOfDay(dateFrom).toISOString());
      }

      if (dateTo) {
        query = query.lte('created_at', endOfDay(dateTo).toISOString());
      }

      const from = (currentPage - 1) * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;
      setLogs(data || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error('Error fetching error logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = async () => {
    setExporting(true);
    try {
      let query = supabase
        .from('error_logs')
        .select('*')
        .order('created_at', { ascending: false });

      if (errorTypeFilter !== 'all') {
        query = query.eq('error_type', errorTypeFilter);
      }
      if (searchQuery) {
        query = query.or(`error_message.ilike.%${searchQuery}%,error_type.ilike.%${searchQuery}%`);
      }
      if (dateFrom) {
        query = query.gte('created_at', startOfDay(dateFrom).toISOString());
      }
      if (dateTo) {
        query = query.lte('created_at', endOfDay(dateTo).toISOString());
      }

      const { data, error } = await query.limit(1000);
      if (error) throw error;

      if (!data || data.length === 0) {
        toast.error('No logs to export');
        return;
      }

      const headers = ['Timestamp', 'Error Type', 'Message', 'URL', 'User ID', 'User Agent'];
      const csvRows = [
        headers.join(','),
        ...data.map((log: any) => [
          format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss'),
          log.error_type,
          (log.error_message || '').replace(/,/g, ';').replace(/"/g, "'"),
          log.url || '',
          log.user_id || '',
          (log.user_agent || '').replace(/,/g, ';')
        ].map(field => `"${field}"`).join(','))
      ];

      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `error-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(`Exported ${data.length} error logs`);
    } catch (error) {
      console.error('Error exporting logs:', error);
      toast.error('Failed to export logs');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [currentPage, errorTypeFilter, dateFrom, dateTo]);

  const handleSearch = () => {
    setCurrentPage(1);
    fetchLogs();
  };

  const getErrorTypeColor = (type: string) => {
    switch (type.toLowerCase()) {
      case 'auth_error':
        return 'text-destructive';
      case 'database_error':
        return 'text-warning';
      case 'validation_error':
        return 'text-info';
      default:
        return 'text-muted-foreground';
    }
  };

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by error message or type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-9"
            />
          </div>
          <Select value={errorTypeFilter} onValueChange={(value) => { setErrorTypeFilter(value); setCurrentPage(1); }}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Error Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="auth_error">Auth Error</SelectItem>
              <SelectItem value="database_error">Database Error</SelectItem>
              <SelectItem value="validation_error">Validation Error</SelectItem>
              <SelectItem value="network_error">Network Error</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={fetchLogs}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        
        {/* Date Range and Export */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[140px] justify-start text-left font-normal">
                  <Calendar className="mr-2 h-4 w-4" />
                  {dateFrom ? format(dateFrom, 'MMM d, yyyy') : 'From'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={dateFrom}
                  onSelect={setDateFrom}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <span className="text-muted-foreground">—</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[140px] justify-start text-left font-normal">
                  <Calendar className="mr-2 h-4 w-4" />
                  {dateTo ? format(dateTo, 'MMM d, yyyy') : 'To'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={dateTo}
                  onSelect={setDateTo}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            {(dateFrom || dateTo) && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}
              >
                Clear
              </Button>
            )}
          </div>
          <div className="sm:ml-auto">
            <Button 
              variant="outline" 
              onClick={exportToCSV} 
              disabled={exporting || loading}
            >
              <Download className="h-4 w-4 mr-2" />
              {exporting ? 'Exporting...' : 'Export CSV'}
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Timestamp</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Message</th>
                <th className="px-4 py-3 text-left font-medium">URL</th>
                <th className="px-4 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Loading error logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    <Bug className="h-8 w-8 mx-auto mb-2 text-success" />
                    No errors found - system is running smoothly!
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-xs">
                        <p className="font-medium">{format(new Date(log.created_at), 'MMM d, yyyy')}</p>
                        <p className="text-muted-foreground">{format(new Date(log.created_at), 'HH:mm:ss')}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={`h-4 w-4 ${getErrorTypeColor(log.error_type)}`} />
                        <Badge variant="outline" className="capitalize">
                          {log.error_type.replace('_', ' ')}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-destructive font-medium truncate max-w-[300px]">
                        {log.error_message}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {log.url && (
                        <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                          {log.url}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedLog(log)}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Details
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {logs.length} of {totalCount} errors
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">
            Page {currentPage} of {totalPages || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Error Details Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Error Details
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Timestamp</p>
                  <p className="font-medium">
                    {format(new Date(selectedLog.created_at), 'PPpp')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Error Type</p>
                  <Badge variant="destructive" className="capitalize">
                    {selectedLog.error_type.replace('_', ' ')}
                  </Badge>
                </div>
              </div>

              <div>
                <p className="text-sm text-muted-foreground mb-1">Error Message</p>
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                  <p className="text-destructive font-medium">{selectedLog.error_message}</p>
                </div>
              </div>

              {selectedLog.error_stack && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Stack Trace</p>
                  <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
                    {selectedLog.error_stack}
                  </pre>
                </div>
              )}

              {selectedLog.url && (
                <div>
                  <p className="text-sm text-muted-foreground">URL</p>
                  <p className="font-mono text-sm">{selectedLog.url}</p>
                </div>
              )}

              {selectedLog.user_agent && (
                <div>
                  <p className="text-sm text-muted-foreground">User Agent</p>
                  <p className="text-xs text-muted-foreground">{selectedLog.user_agent}</p>
                </div>
              )}

              {selectedLog.context && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Context</p>
                  <pre className="bg-muted p-3 rounded-lg text-xs overflow-x-auto">
                    {JSON.stringify(selectedLog.context, null, 2)}
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
