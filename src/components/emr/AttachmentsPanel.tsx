import { useState } from 'react';
import { format } from 'date-fns';
import { Upload, FileText, Download, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useEmrAttachments } from '@/hooks/useEmrAttachments';
import { useAuth } from '@/contexts/AuthContext';

const CATEGORIES = ['scan', 'lab_report', 'referral', 'imaging', 'other'];
const UPLOAD_ROLES = ['doctor', 'doctor1', 'doctor2', 'nurse', 'admin'];

export function AttachmentsPanel({ patientId }: { patientId: string }) {
  const { attachments, loading, uploadAttachment, getSignedUrl } = useEmrAttachments(patientId);
  const { role } = useAuth();
  const canUpload = role && UPLOAD_ROLES.includes(role);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('other');
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    const res = await uploadAttachment(file, category, description);
    setUploading(false);
    if (res) {
      setFile(null);
      setDescription('');
      setCategory('other');
      setOpen(false);
    }
  };

  const handleDownload = async (path: string, name: string) => {
    const url = await getSignedUrl(path);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Attachments</h3>
        {canUpload && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Upload className="h-4 w-4 mr-1" /> Upload file
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-6">Loading...</p>
      ) : attachments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Paperclip className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No attachments yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {attachments.map((a) => (
            <Card key={a.id} className="p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <FileText className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" title={a.file_name}>{a.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(a.created_at), 'MMM dd, yyyy • h:mm a')}
                  </p>
                </div>
                <Badge variant="secondary" className="text-xs capitalize">{a.category.replace('_', ' ')}</Badge>
              </div>
              {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
              <Button size="sm" variant="outline" className="mt-auto" onClick={() => handleDownload(a.file_path, a.file_name)}>
                <Download className="h-3.5 w-3.5 mr-1" /> Open
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload attachment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>File</Label>
              <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={!file || uploading}>
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
