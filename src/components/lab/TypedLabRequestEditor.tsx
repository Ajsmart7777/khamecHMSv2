import React, { useState } from 'react';
import { Plus, Trash2, Search, Loader2, Beaker } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { fuzzyMatchPricelist, PricelistItem } from '@/hooks/usePricelist';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { createLabRequestFromTyped } from '@/integrations/supabase/rpcs';

interface TypedLabRequestEditorProps {
  patientId: string;
  visitId: string | null;
  onSuccess?: (labRequestId: string) => void;
  onCancel?: () => void;
}

export function TypedLabRequestEditor({
  patientId,
  visitId,
  onSuccess,
  onCancel
}: TypedLabRequestEditorProps) {
  const [tests, setTests] = useState<string[]>(['']);
  const [diagnosis, setDiagnosis] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState<number | null>(null);
  const [searchResults, setSearchResults] = useState<PricelistItem[]>([]);

  const addTest = () => {
    setTests([...tests, '']);
  };

  const removeTest = (index: number) => {
    if (tests.length > 1) {
      setTests(tests.filter((_, i) => i !== index));
    }
  };

  const updateTest = (index: number, value: string) => {
    const newTests = [...tests];
    newTests[index] = value;
    setTests(newTests);
  };

  const handleSearch = async (index: number, query: string) => {
    updateTest(index, query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    const matches = await fuzzyMatchPricelist(query);
    setSearchResults(matches.filter(m => m.category === 'lab' || m.category === 'imaging'));
  };

  const selectTest = (index: number, item: PricelistItem) => {
    updateTest(index, `${item.name}${item.size ? ' (' + item.size + ')' : ''}`);
    setSearching(null);
  };

  const handleSubmit = async () => {
    const validTests = tests.filter(t => t.trim().length > 0);
    if (validTests.length === 0) {
      return toast.error('At least one test is required');
    }

    setLoading(true);
    try {
      const id = await createLabRequestFromTyped({
        patientId,
        visitId,
        diagnosis: diagnosis.trim() || undefined,
        tests: validTests
      });
      toast.success('Lab request created');
      onSuccess?.(id);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create lab request');
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
            placeholder="Reason for tests..." 
            value={diagnosis} 
            onChange={e => setDiagnosis(e.target.value)}
          />
        </div>

        <div className="space-y-4">
          <Label className="text-base font-semibold">Requested Tests</Label>
          <div className="space-y-2">
            {tests.map((test, idx) => (
              <div key={idx} className="flex gap-2 items-start group">
                <div className="flex-1 relative">
                  <Popover open={searching === idx} onOpenChange={(o) => setSearching(o ? idx : null)}>
                    <PopoverTrigger asChild>
                      <div className="relative">
                        <Input 
                          placeholder="Search or type test name..." 
                          value={test}
                          onChange={e => handleSearch(idx, e.target.value)}
                        />
                        <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[350px]" align="start">
                      <Command>
                        <CommandList>
                          <CommandEmpty>No matching tests found in pricelist.</CommandEmpty>
                          <CommandGroup heading="Tests from Pricelist">
                            {searchResults.map(item => (
                              <CommandItem 
                                key={item.id} 
                                onSelect={() => selectTest(idx, item)}
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
                {tests.length > 1 && (
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-destructive opacity-50 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeTest(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          
          <Button variant="outline" className="w-full" onClick={addTest}>
            <Plus className="h-4 w-4 mr-2" /> Add Another Test
          </Button>
        </div>
      </div>

      <div className="flex justify-end gap-3 border-t pt-4">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
        )}
        <Button onClick={handleSubmit} disabled={loading} className="min-w-[120px]">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Beaker className="h-4 w-4 mr-2" />}
          Submit Lab Order
        </Button>
      </div>
    </div>
  );
}
