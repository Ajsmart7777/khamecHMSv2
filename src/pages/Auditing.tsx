import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  ClipboardCheck, 
  FileText,
  Download,
  Filter,
  Search,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Eye
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { mockActivityLogs } from '@/data/mockData';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { toast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const initialAuditReports = [
  { id: 1, title: 'Daily Transaction Report', date: '2024-12-30', status: 'completed', type: 'financial' },
  { id: 2, title: 'Patient Flow Analysis', date: '2024-12-30', status: 'pending', type: 'operations' },
  { id: 3, title: 'Inventory Discrepancy Check', date: '2024-12-29', status: 'flagged', type: 'inventory' },
  { id: 4, title: 'Staff Activity Log', date: '2024-12-29', status: 'completed', type: 'hr' },
];

const Auditing = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [auditReports, setAuditReports] = useState(initialAuditReports);
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<typeof initialAuditReports[0] | null>(null);
  const [filterType, setFilterType] = useState('all');

  const filteredLogs = searchQuery
    ? mockActivityLogs.filter(log => 
        log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.userName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : mockActivityLogs;

  const handleDownloadReport = (report: typeof initialAuditReports[0]) => {
    toast({
      title: "Downloading Report",
      description: `${report.title} is being downloaded...`,
    });
    setTimeout(() => {
      toast({
        title: "Download Complete",
        description: `${report.title} has been downloaded.`,
      });
    }, 1500);
  };

  const handleViewReport = (report: typeof initialAuditReports[0]) => {
    setSelectedReport(report);
    setIsReportDialogOpen(true);
  };

  const handleGenerateReport = () => {
    setIsGenerateDialogOpen(true);
  };

  const confirmGenerateReport = () => {
    const newReport = {
      id: auditReports.length + 1,
      title: 'Custom Audit Report',
      date: new Date().toISOString().split('T')[0],
      status: 'pending' as const,
      type: 'custom' as const,
    };
    setAuditReports([newReport, ...auditReports]);
    toast({
      title: "Report Generating",
      description: "Your custom audit report is being generated. This may take a few minutes.",
    });
    setIsGenerateDialogOpen(false);
    
    // Simulate report completion
    setTimeout(() => {
      setAuditReports(reports => 
        reports.map(r => r.id === newReport.id ? { ...r, status: 'completed' } : r)
      );
      toast({
        title: "Report Ready",
        description: "Your custom audit report is ready for download.",
      });
    }, 3000);
  };

  const handleApplyFilter = () => {
    toast({
      title: "Filter Applied",
      description: `Showing ${filterType === 'all' ? 'all' : filterType} logs.`,
    });
    setIsFilterDialogOpen(false);
  };

  const handleLogClick = (log: typeof mockActivityLogs[0]) => {
    toast({
      title: log.action,
      description: `${log.userName} (${log.role}) - ${log.details}\nTime: ${new Date(log.timestamp).toLocaleString()}`,
    });
  };

  return (
    <MainLayout title="Auditing" subtitle="Compliance monitoring and transaction verification">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatsCard
          title="Today's Transactions"
          value="156"
          icon={TrendingUp}
          color="text-module-auditing"
        />
        <StatsCard
          title="Verified"
          value="142"
          subtitle="91% compliance"
          icon={CheckCircle}
          color="text-success"
        />
        <StatsCard
          title="Pending Review"
          value="12"
          icon={ClipboardCheck}
          color="text-warning"
        />
        <StatsCard
          title="Flagged Issues"
          value="2"
          icon={AlertTriangle}
          color="text-destructive"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity Log */}
        <div className="lg:col-span-2">
          <div className="bg-card rounded-xl border border-border">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-module-auditing" />
                System Activity Log
              </h3>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Search logs..." 
                    className="pl-10 w-48"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={() => setIsFilterDialogOpen(true)}
                  className="press-effect"
                >
                  <Filter className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="divide-y divide-border max-h-96 overflow-y-auto">
              {[...filteredLogs, ...filteredLogs].map((log, index) => (
                <div 
                  key={`${log.id}-${index}`} 
                  className="p-4 hover:bg-muted/30 transition-colors cursor-pointer animate-fade-in"
                  onClick={() => handleLogClick(log)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{log.userName}</span>
                        <Badge variant={log.role as any} className="text-[10px]">{log.role}</Badge>
                      </div>
                      <p className="text-sm">{log.action}</p>
                      <p className="text-xs text-muted-foreground mt-1">{log.details}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(log.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Reports */}
        <div className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-module-auditing" />
              Audit Reports
            </h3>

            <div className="space-y-3">
              {auditReports.map((report) => (
                <div key={report.id} className="p-3 border border-border rounded-lg animate-fade-in">
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="secondary" className="text-[10px]">{report.type}</Badge>
                    <Badge 
                      variant={
                        report.status === 'completed' ? 'success' : 
                        report.status === 'flagged' ? 'destructive' : 'warning'
                      }
                      className="text-[10px]"
                    >
                      {report.status}
                    </Badge>
                  </div>
                  <p className="font-medium text-sm">{report.title}</p>
                  <p className="text-xs text-muted-foreground">{report.date}</p>
                  <div className="flex gap-2 mt-2">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="flex-1 press-effect"
                      onClick={() => handleViewReport(report)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="flex-1 press-effect"
                      onClick={() => handleDownloadReport(report)}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Button variant="hero" className="w-full press-effect" onClick={handleGenerateReport}>
            <FileText className="h-4 w-4 mr-2" />
            Generate New Report
          </Button>
        </div>
      </div>

      {/* Filter Dialog */}
      <Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle>Filter Activity Logs</DialogTitle>
            <DialogDescription>Select filters to apply to the activity log</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Activity Type</label>
              <select 
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                <option value="all">All Activities</option>
                <option value="patient">Patient Related</option>
                <option value="billing">Billing & Payments</option>
                <option value="inventory">Inventory Changes</option>
                <option value="admin">Admin Actions</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Date Range</label>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" placeholder="From" />
                <Input type="date" placeholder="To" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">User Role</label>
              <select className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm">
                <option value="all">All Roles</option>
                <option value="doctor">Doctors</option>
                <option value="nurse">Nurses</option>
                <option value="receptionist">Receptionists</option>
                <option value="admin">Administrators</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFilterDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleApplyFilter} className="press-effect">
              <Filter className="h-4 w-4 mr-1" />
              Apply Filter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Report Dialog */}
      <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
        <DialogContent className="animate-scale-in max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedReport?.title}</DialogTitle>
            <DialogDescription>Generated on {selectedReport?.date}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="p-4 bg-muted/30 rounded-lg text-center">
                <p className="text-2xl font-bold">156</p>
                <p className="text-sm text-muted-foreground">Total Transactions</p>
              </div>
              <div className="p-4 bg-success/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-success">142</p>
                <p className="text-sm text-muted-foreground">Verified</p>
              </div>
              <div className="p-4 bg-warning/10 rounded-lg text-center">
                <p className="text-2xl font-bold text-warning">14</p>
                <p className="text-sm text-muted-foreground">Pending Review</p>
              </div>
            </div>
            <div className="space-y-3">
              <h4 className="font-medium">Key Findings</h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success mt-0.5" />
                  <span>All patient records properly updated</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success mt-0.5" />
                  <span>Payment reconciliation matches billing records</span>
                </li>
                <li className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning mt-0.5" />
                  <span>2 inventory discrepancies require attention</span>
                </li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReportDialogOpen(false)}>Close</Button>
            <Button onClick={() => handleDownloadReport(selectedReport!)} className="press-effect">
              <Download className="h-4 w-4 mr-1" />
              Download Full Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate Report Dialog */}
      <Dialog open={isGenerateDialogOpen} onOpenChange={setIsGenerateDialogOpen}>
        <DialogContent className="animate-scale-in">
          <DialogHeader>
            <DialogTitle>Generate New Report</DialogTitle>
            <DialogDescription>Configure your custom audit report</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Report Type</label>
              <select className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm">
                <option>Financial Transactions</option>
                <option>Patient Flow Analysis</option>
                <option>Inventory Audit</option>
                <option>Staff Activity</option>
                <option>Comprehensive Report</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Date Range</label>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" />
                <Input type="date" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Include Sections</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" defaultChecked className="rounded" />
                  <span className="text-sm">Transaction Summary</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" defaultChecked className="rounded" />
                  <span className="text-sm">Compliance Status</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" defaultChecked className="rounded" />
                  <span className="text-sm">Flagged Items</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="rounded" />
                  <span className="text-sm">Detailed Activity Log</span>
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsGenerateDialogOpen(false)}>Cancel</Button>
            <Button onClick={confirmGenerateReport} className="press-effect">
              <FileText className="h-4 w-4 mr-1" />
              Generate Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Auditing;