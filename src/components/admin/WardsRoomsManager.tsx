import { useMemo, useState } from 'react';
import { Building2, DoorOpen, Bed as BedIcon, Plus, Trash2, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  useWardsRoomsBeds, Ward, Room, Bed, WardGender, RoomClass, BedStatus,
} from '@/hooks/useWardsRooms';

const bedTone: Record<BedStatus, string> = {
  available: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
  occupied: 'bg-rose-500/10 text-rose-700 border-rose-500/30',
  maintenance: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
};

export function WardsRoomsManager() {
  const s = useWardsRoomsBeds();
  const [selectedWard, setSelectedWard] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

  const roomsInWard = useMemo(
    () => s.rooms.filter((r) => r.ward_id === selectedWard),
    [s.rooms, selectedWard],
  );
  const bedsInRoom = useMemo(
    () => s.beds.filter((b) => b.room_id === selectedRoom),
    [s.beds, selectedRoom],
  );

  const wardStats = (w: Ward) => {
    const rIds = s.rooms.filter((r) => r.ward_id === w.id).map((r) => r.id);
    const rBeds = s.beds.filter((b) => rIds.includes(b.room_id));
    const avail = rBeds.filter((b) => b.status === 'available').length;
    return { rooms: rIds.length, total: rBeds.length, avail };
  };

  const roomStats = (r: Room) => {
    const rBeds = s.beds.filter((b) => b.room_id === r.id);
    return { total: rBeds.length, avail: rBeds.filter((b) => b.status === 'available').length };
  };

  const [wardDialog, setWardDialog] = useState<{ open: boolean; row?: Ward } | null>(null);
  const [roomDialog, setRoomDialog] = useState<{ open: boolean; row?: Room } | null>(null);
  const [bedDialog, setBedDialog] = useState<{ open: boolean; row?: Bed } | null>(null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* WARDS */}
        <div className="bg-card rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Wards</h3>
              <Badge variant="outline" className="text-[10px]">{s.wards.length}</Badge>
            </div>
            <Button size="sm" onClick={() => setWardDialog({ open: true })}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {s.wards.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">No wards yet</p>
          ) : (
            <div className="space-y-1 max-h-[420px] overflow-y-auto">
              {s.wards.map((w) => {
                const st = wardStats(w);
                const active = selectedWard === w.id;
                return (
                  <div
                    key={w.id}
                    onClick={() => { setSelectedWard(w.id); setSelectedRoom(null); }}
                    className={`p-2 rounded-lg border cursor-pointer transition-colors ${active ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{w.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {w.ward_type} · {w.gender} · {st.rooms} room(s) · {st.avail}/{st.total} beds free
                        </p>
                      </div>
                      <div className="flex gap-0.5">
                        <Button size="icon" variant="ghost" className="h-6 w-6"
                          onClick={(e) => { e.stopPropagation(); setWardDialog({ open: true, row: w }); }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6"
                          onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ward "${w.name}"?`)) s.deleteWard(w.id); }}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ROOMS */}
        <div className="bg-card rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <DoorOpen className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Rooms</h3>
              <Badge variant="outline" className="text-[10px]">{roomsInWard.length}</Badge>
            </div>
            <Button size="sm" disabled={!selectedWard}
              onClick={() => setRoomDialog({ open: true })}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {!selectedWard ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Select a ward</p>
          ) : roomsInWard.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">No rooms yet</p>
          ) : (
            <div className="space-y-1 max-h-[420px] overflow-y-auto">
              {roomsInWard.map((r) => {
                const st = roomStats(r);
                const active = selectedRoom === r.id;
                return (
                  <div key={r.id}
                    onClick={() => setSelectedRoom(r.id)}
                    className={`p-2 rounded-lg border cursor-pointer transition-colors ${active ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">Room {r.room_number}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {r.room_class} · ₦{Number(r.daily_rate).toLocaleString()}/day · {st.avail}/{st.total} free
                        </p>
                      </div>
                      <div className="flex gap-0.5">
                        <Button size="icon" variant="ghost" className="h-6 w-6"
                          onClick={(e) => { e.stopPropagation(); setRoomDialog({ open: true, row: r }); }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6"
                          onClick={(e) => { e.stopPropagation(); if (confirm(`Delete room ${r.room_number}?`)) s.deleteRoom(r.id); }}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* BEDS */}
        <div className="bg-card rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BedIcon className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Beds</h3>
              <Badge variant="outline" className="text-[10px]">{bedsInRoom.length}</Badge>
            </div>
            <Button size="sm" disabled={!selectedRoom}
              onClick={() => setBedDialog({ open: true })}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {!selectedRoom ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Select a room</p>
          ) : bedsInRoom.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">No beds yet</p>
          ) : (
            <div className="space-y-1 max-h-[420px] overflow-y-auto">
              {bedsInRoom.map((b) => (
                <div key={b.id} className="p-2 rounded-lg border">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">Bed {b.bed_label}</p>
                      <Badge variant="outline" className={`text-[10px] mt-1 ${bedTone[b.status]}`}>
                        {b.status}
                      </Badge>
                    </div>
                    <div className="flex gap-0.5">
                      <Button size="icon" variant="ghost" className="h-6 w-6"
                        onClick={() => setBedDialog({ open: true, row: b })}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6"
                        onClick={() => { if (confirm(`Delete bed ${b.bed_label}?`)) s.deleteBed(b.id); }}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {wardDialog?.open && (
        <WardDialog
          initial={wardDialog.row}
          onClose={() => setWardDialog(null)}
          onSave={async (data) => { if (await s.saveWard(data)) setWardDialog(null); }}
        />
      )}
      {roomDialog?.open && selectedWard && (
        <RoomDialog
          wardId={selectedWard}
          initial={roomDialog.row}
          onClose={() => setRoomDialog(null)}
          onSave={async (data) => { if (await s.saveRoom(data)) setRoomDialog(null); }}
        />
      )}
      {bedDialog?.open && selectedRoom && (
        <BedDialog
          roomId={selectedRoom}
          initial={bedDialog.row}
          onClose={() => setBedDialog(null)}
          onSave={async (data) => { if (await s.saveBed(data)) setBedDialog(null); }}
        />
      )}
    </div>
  );
}

function WardDialog({ initial, onClose, onSave }: {
  initial?: Ward;
  onClose: () => void;
  onSave: (data: Partial<Ward> & { name: string }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [wardType, setWardType] = useState(initial?.ward_type ?? 'normal');
  const [gender, setGender] = useState<WardGender>(initial?.gender ?? 'any');
  const [description, setDescription] = useState(initial?.description ?? '');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Ward' : 'Add Ward'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Ward Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Male Medical" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <Select value={wardType} onValueChange={setWardType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal Room</SelectItem>
                  <SelectItem value="vip">VIP Room</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Gender</Label>
              <Select value={gender} onValueChange={(v) => setGender(v as WardGender)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><X className="h-4 w-4 mr-1" />Cancel</Button>
          <Button disabled={!name.trim()}
            onClick={() => onSave({ id: initial?.id, name, ward_type: wardType, gender, description })}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoomDialog({ wardId, initial, onClose, onSave }: {
  wardId: string;
  initial?: Room;
  onClose: () => void;
  onSave: (data: Partial<Room> & { ward_id: string; room_number: string }) => void;
}) {
  const [roomNumber, setRoomNumber] = useState(initial?.room_number ?? '');
  const [roomClass, setRoomClass] = useState<RoomClass>(initial?.room_class ?? 'general');
  const [dailyRate, setDailyRate] = useState<string>(String(initial?.daily_rate ?? 0));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{initial ? 'Edit Room' : 'Add Room'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Room Number *</Label>
            <Input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="101" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Class</Label>
              <Select value={roomClass} onValueChange={(v) => setRoomClass(v as RoomClass)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="semi_private">Semi-Private</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="vip">VIP</SelectItem>
                  <SelectItem value="icu">ICU</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Daily Rate (₦)</Label>
              <Input type="number" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><X className="h-4 w-4 mr-1" />Cancel</Button>
          <Button disabled={!roomNumber.trim()}
            onClick={() => onSave({ id: initial?.id, ward_id: wardId, room_number: roomNumber, room_class: roomClass, daily_rate: Number(dailyRate) || 0 })}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BedDialog({ roomId, initial, onClose, onSave }: {
  roomId: string;
  initial?: Bed;
  onClose: () => void;
  onSave: (data: Partial<Bed> & { room_id: string; bed_label: string }) => void;
}) {
  const [bedLabel, setBedLabel] = useState(initial?.bed_label ?? '');
  const [status, setStatus] = useState<BedStatus>(initial?.status ?? 'available');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{initial ? 'Edit Bed' : 'Add Bed'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Bed Label *</Label>
            <Input value={bedLabel} onChange={(e) => setBedLabel(e.target.value)} placeholder="A" />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as BedStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="occupied">Occupied</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><X className="h-4 w-4 mr-1" />Cancel</Button>
          <Button disabled={!bedLabel.trim()}
            onClick={() => onSave({ id: initial?.id, room_id: roomId, bed_label: bedLabel, status })}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
