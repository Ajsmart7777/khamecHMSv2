import React, { useState } from 'react';
import { Plus, Trash2, Search, Loader2, Pill } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { fuzzyMatchPricelist, PricelistItem } from '@/hooks/usePricelist';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { createPrescriptionFromTyped } from '@/integrations/supabase/rpcs';

interface MedicationLine {
  id: string;
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  quantity: string;
}

interface TypedPrescriptionEditorProps {
  patientId: string;
  visitId: string | null;
  onSuccess?: (prescriptionId: string) => void;
  onCancel?: () => void;
}

export function TypedPrescriptionEditor({
  patientId,
  visitId,
  onSuccess,
  onCancel
}: TypedPrescriptionEditorProps) {
  const [lines, setLines] = useState<MedicationLine[]>([
    { id: Math.random().toString(), medication: '', dosage: '', frequency: '', duration: '', quantity: '' }
  ]);
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<PricelistItem[]>([]);

  const addLine = () => {
    setLines([...lines, { id: Math.random().toString(), medication: '', dosage: '', frequency: '', duration: '', quantity: '' }]);
  };

  const removeLine = (id: string) => {
    if (lines.length > 1) {
      setLines(lines.filter(l => l.id !== id));
    }
  };

  const updateLine = (id: string, field: keyof MedicationLine, value: string) => {
    setLines(lines.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const handleSearch = async (id: string, query: string) => {
    updateLine(id, 'medication', query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    const matches = await fuzzyMatchPricelist(query);
    setSearchResults(matches.filter(m => m.category.startsWith('drug')));
  };

  const selectMed = (id: string, item: PricelistItem) => {
    updateLine(id, 'medication', `${item.name}${item.size ? ' (' + item.size + ')' : ''}`);
    setSearching(null);
  };

  const handleSubmit = async () => {
    // Basic validation
    for (const line of lines) {
      if (!line.medication.trim()) return toast.error('Medication name is required');
      if (!line.dosage.trim()) return toast.error(`Dosage is required for ${line.medication}`);
      if (!line.frequency.trim()) return toast.error(`Frequency is required for ${line.medication}`);
      if (!line.duration.trim()) return toast.error(`Duration is required for ${line.medication}`);
      if (!line.quantity.trim() || isNaN(parseInt(line.quantity)) || parseInt(line.quantity) <= 0) {
        return toast.error(`Valid quantity is required for ${line.medication}`);
      }
    }

    setLoading(true);
    try {
      const id = await createPrescriptionFromTyped({
        patientId,
        visitId,
        diagnosis,
        notes,
        items: lines.map(l => ({
          medication: l.medication,
          dosage: l.dosage,
          frequency: l.frequency,
          duration: l.duration,
          quantity: parseInt(l.quantity)
        }))
      });
      toast.success('Prescription created');
      onSuccess?.(id);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create prescription');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Diagnosis (Optional)</Label>
          <Input 
            placeholder="Enter diagnosis..." 
            value={diagnosis} 
            onChange={e => setDiagnosis(e.target.value)}
          />
        </div>

        <div className="space-y-4">
          <Label className="text-base font-semibold">Medications</Label>
          {lines.map((line, idx) => (
            <div key={line.id} className="p-4 border rounded-lg space-y-4 bg-muted/30 relative">
              {lines.length > 1 && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="absolute top-2 right-2 text-destructive"
                  onClick={() => removeLine(line.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 relative">
                  <Label>Medication Name</Label>
                  <Popover open={searching === line.id} onOpenChange={(o) => setSearching(o ? line.id : null)}>
                    <PopoverTrigger asChild>
                      <div className="relative">
                        <Input 
                          placeholder="Search or type medication..." 
                          value={line.medication}
                          onChange={e => handleSearch(line.id, e.target.value)}
                        />
                        <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[300px]" align="start">
                      <Command>
                        <CommandList>
                          <CommandEmpty>No medications found in pricelist.</CommandEmpty>
                          <CommandGroup heading="Results from Pricelist">
                            {searchResults.map(item => (
                              <CommandItem 
                                key={item.id} 
                                onSelect={() => selectMed(line.id, item)}
                                className="cursor-pointer"
                              >
                                <div className="flex flex-col">
                                  <span>{item.name}</span>
                                  <span className="text-xs text-muted-foreground">{item.size} • {item.category}</span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Dosage</Label>
                  <Input 
                    placeholder="e.g. 500mg, 1 tablet" 
                    value={line.dosage}
                    onChange={e => updateLine(line.id, 'dosage', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <Input 
                    placeholder="e.g. Twice daily, 8 hourly" 
                    value={line.frequency}
                    onChange={e => updateLine(line.id, 'frequency', e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Duration</Label>
                    <Input 
                      placeholder="e.g. 5 days" 
                      value={line.duration}
                      onChange={e => updateLine(line.id, 'duration', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Qty (Total Units)</Label>
                    <Input 
                      type="number"
                      placeholder="e.g. 10" 
                      value={line.quantity}
                      onChange={e => updateLine(line.id, 'quantity', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
          
          <Button variant="outline" className="w-full" onClick={addLine}>
            <Plus className="h-4 w-4 mr-2" /> Add Another Medication
          </Button>
        </div>

        <div className="space-y-2">
          <Label>General Notes (Optional)</Label>
          <Textarea 
            placeholder="Additional instructions..." 
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 border-t pt-4">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
        )}
        <Button onClick={handleSubmit} disabled={loading} className="min-w-[120px]">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Pill className="h-4 w-4 mr-2" />}
          Submit Prescription
        </Button>
      </div>
    </div>
  );
}
