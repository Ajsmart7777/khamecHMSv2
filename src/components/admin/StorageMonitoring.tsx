import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Database, HardDrive, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { ExternalLink, Settings } from 'lucide-react';

interface StorageStats {
  database: {
    size_bytes: number;
    size_formatted: string;
    quota_bytes: number | null;
    usage_percent: number | null;
  };
  r2: {
    bucket: string;
    total_objects: number;
    total_size_bytes: number;
    total_size_formatted: string;
    quota_bytes: number | null;
    usage_percent: number | null;
    breakdown: Record<string, { objects: number, size: number }>;
    isConfigured: boolean;
  } | null;
  lastUpdated: Date;
}

export function StorageMonitoring() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch DB size via RPC
      const { data: dbData, error: dbError } = await supabase.rpc('get_database_size');
      if (dbError) throw dbError;

      const dbSizeBytes = dbData[0]?.database_size_bytes ?? 0;

      // 2. Fetch R2 usage via Edge Function
      let r2Stats = null;
      try {
        const { data: r2Data, error: r2Error } = await supabase.functions.invoke('r2-usage');
        
        if (r2Error) {
          console.warn('R2 usage fetch error:', r2Error);
          // If the error specifically says R2 is not configured, we want to reflect that
          if (r2Error.message?.includes('not configured') || r2Error.debug?.accountId === false) {
            r2Stats = {
              bucket: '',
              total_objects: 0,
              total_size_bytes: 0,
              total_size_formatted: '0 Bytes',
              quota_bytes: null,
              usage_percent: null,
              breakdown: {},
              isConfigured: false
            };
          } else {
            // Unexpected error (e.g. 403 Unauthorized)
            console.error('R2 unexpected error:', r2Error);
            throw new Error(r2Error.error || r2Error.message || 'Failed to fetch R2 usage');
          }
        } else if (r2Data) {
          r2Stats = {
            bucket: r2Data.bucket || '',
            total_objects: r2Data.total_objects ?? 0,
            total_size_bytes: r2Data.total_size_bytes ?? 0,
            total_size_formatted: formatBytes(r2Data.total_size_bytes ?? 0),
            quota_bytes: null,
            usage_percent: null,
            breakdown: r2Data.breakdown || {},
            isConfigured: true
          };
        }
      } catch (err) {
        console.warn('Could not invoke r2-usage:', err);
      }

      setStats({
        database: {
          size_bytes: dbSizeBytes,
          size_formatted: formatBytes(dbSizeBytes),
          quota_bytes: 5 * 1024 * 1024 * 1024, // Assuming 5GB free tier default if not known
          usage_percent: (dbSizeBytes / (5 * 1024 * 1024 * 1024)) * 100
        },
        r2: r2Stats,
        lastUpdated: new Date()
      });
    } catch (err: any) {
      console.error('Storage monitoring error:', err);
      setError(err.message || 'Failed to fetch storage statistics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const getStatus = (percent: number | null) => {
    if (percent === null) return { label: 'Active', color: 'text-success', icon: CheckCircle2 };
    if (percent > 95) return { label: 'Critical', color: 'text-destructive', icon: AlertCircle };
    if (percent > 85) return { label: 'High Usage', color: 'text-orange-500', icon: AlertTriangle };
    if (percent > 70) return { label: 'Warning', color: 'text-warning', icon: AlertTriangle };
    return { label: 'Healthy', color: 'text-success', icon: CheckCircle2 };
  };

  if (loading && !stats) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Retrieving system storage usage...</p>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="py-10 text-center">
          <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-4" />
          <h3 className="font-semibold text-lg mb-2">Usage Data Unavailable</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">{error}</p>
          <Button onClick={fetchStats} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry Connection
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">System Storage</h2>
          <p className="text-muted-foreground">Monitor database and object storage infrastructure</p>
        </div>
        <div className="flex items-center gap-4">
          {stats && (
            <span className="text-xs text-muted-foreground">
              Last updated: {stats.lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchStats} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Supabase Database Card */}
        <Card className="overflow-hidden border-border/60">
          <CardHeader className="pb-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Supabase Database</CardTitle>
              </div>
              {stats && (
                <Badge variant="outline" className={getStatus(stats.database.usage_percent).color}>
                  {getStatus(stats.database.usage_percent).label}
                </Badge>
              )}
            </div>
            <CardDescription>PostgreSQL relational data storage</CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            {stats && (
              <>
                <div className="flex justify-between items-end">
                  <div>
                    <span className="text-3xl font-bold">{stats.database.size_formatted}</span>
                    <span className="text-sm text-muted-foreground ml-2">used</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Approx. Quota</p>
                    <p className="text-sm font-medium">{formatBytes(stats.database.quota_bytes || 0)}</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span>Usage</span>
                    <span>{stats.database.usage_percent?.toFixed(1)}%</span>
                  </div>
                  <Progress value={stats.database.usage_percent || 0} className="h-2" />
                </div>

                <div className="pt-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    {getStatus(stats.database.usage_percent).label === 'Healthy' ? (
                      <CheckCircle2 className="h-3 w-3 text-success" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 text-warning" />
                    )}
                    {stats.database.usage_percent && stats.database.usage_percent > 85 
                      ? "Database storage is becoming high. Consider reviewing storage usage."
                      : "Database storage usage is within normal operating parameters."}
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Cloudflare R2 Card */}
        <Card className="overflow-hidden border-border/60">
          <CardHeader className="pb-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-orange-500" />
                <CardTitle className="text-lg">Cloudflare R2</CardTitle>
              </div>
              {stats?.r2?.isConfigured ? (
                <Badge variant="outline" className="text-success border-success/30">
                  Active
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Not Integrated
                </Badge>
              )}
            </div>
            <CardDescription>Object storage for images and attachments</CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            {stats?.r2?.isConfigured ? (
              <>
                <div className="flex justify-between items-end">
                  <div>
                    <span className="text-3xl font-bold">{stats.r2.total_size_formatted}</span>
                    <span className="text-sm text-muted-foreground ml-2">used</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Total Objects</p>
                    <p className="text-sm font-medium">{stats.r2.total_objects.toLocaleString()}</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span>Usage</span>
                    <span>Quota Unlimited</span>
                  </div>
                  <Progress value={5} className="h-2 opacity-50" />
                </div>

                <div className="pt-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    R2 storage is scaling automatically.
                  </p>
                </div>
              </>
            ) : (
              <div className="py-8 text-center bg-muted/20 rounded-lg border border-dashed">
                <p className="text-sm text-muted-foreground italic">
                  {error?.includes('R2') ? error : 'Cloudflare R2 storage usage could not be retrieved or is not configured.'}
                </p>
                <div className="mt-4 flex flex-col items-center gap-2">
                  <p className="text-xs text-muted-foreground max-w-xs mx-auto mb-2">
                    To enable R2 monitoring and storage, please ensure the following secrets are set in your project:
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Badge variant="secondary" className="font-mono text-[10px]">R2_ACCOUNT_ID</Badge>
                    <Badge variant="secondary" className="font-mono text-[10px]">R2_ACCESS_KEY_ID</Badge>
                    <Badge variant="secondary" className="font-mono text-[10px]">R2_SECRET_ACCESS_KEY</Badge>
                    <Badge variant="secondary" className="font-mono text-[10px]">R2_BUCKET</Badge>
                    <Badge variant="secondary" className="font-mono text-[10px]">VITE_R2_PUBLIC_URL</Badge>
                  </div>
                  <Button 
                    variant="link" 
                    size="sm" 
                    className="mt-2"
                    onClick={() => window.open('https://dash.cloudflare.com/', '_blank')}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Cloudflare Dashboard
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Breakdown Section */}
      {stats?.r2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Storage Breakdown (R2)</CardTitle>
            <CardDescription>Categorized object usage by file path</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/30">
                  <tr>
                    <th className="px-4 py-3 font-medium">Category / Bucket</th>
                    <th className="px-4 py-3 font-medium text-right">Objects</th>
                    <th className="px-4 py-3 font-medium text-right">Total Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {Object.entries(stats.r2.breakdown).map(([key, data]) => (
                    <tr key={key} className="hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3 capitalize font-medium">{key.replace(/-/g, ' ')}</td>
                      <td className="px-4 py-3 text-right">{data.objects.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">{formatBytes(data.size)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/20 font-semibold">
                  <tr>
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{stats.r2.total_objects.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{stats.r2.total_size_formatted}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
