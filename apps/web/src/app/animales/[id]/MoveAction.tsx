'use client';

import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/Button';
import { MoveDialog, type MoveLot } from '@/components/MoveDialog';

/** Acción «Mover» de la ficha (P3 M-2.1): abre el MoveDialog para un solo animal. */
export function MoveAction({ animalId, lots }: { animalId: string; lots: MoveLot[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <ArrowLeftRight size={14} className="mr-1.5" /> Mover
      </Button>
      {open && <MoveDialog animalIds={[animalId]} lots={lots} onClose={() => setOpen(false)} />}
    </>
  );
}
