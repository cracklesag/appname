'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PartApplicationDraw from './PartApplicationDraw';
import { updatePartApplicationArea } from '@/lib/actions';
import type { FieldGeometry } from '@/lib/geo';

/**
 * Edit (redraw) the spread area of an existing part-application. Reuses the
 * same draw surface used to create it, with the current area shown faintly as
 * a guide. On save, swaps the polygon and returns to the part-applications view.
 */
export default function EditPartApplicationArea({
  fieldId,
  applicationId,
  boundary,
  productName,
  k2oPerHa,
  unitSystem,
  guideArea,
}: {
  fieldId: string;
  applicationId: string;
  boundary: FieldGeometry;
  productName: string;
  k2oPerHa: number;
  unitSystem: 'acres' | 'hectares';
  guideArea?: FieldGeometry;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const back = () => router.push(`/fields/${fieldId}/part-applications`);

  return (
    <PartApplicationDraw
      boundary={boundary}
      productName={productName}
      k2oPerHa={k2oPerHa}
      unitSystem={unitSystem}
      guideArea={guideArea}
      onCancel={back}
      onDone={async (geometry) => {
        if (saving) return;
        setSaving(true);
        try {
          const fd = new FormData();
          fd.set('application_id', applicationId);
          fd.set('field_id', fieldId);
          fd.set('application_area', JSON.stringify(geometry));
          await updatePartApplicationArea(fd);
          router.push(`/fields/${fieldId}/part-applications`);
          router.refresh();
        } catch (e) {
          setSaving(false);
          const msg = e instanceof Error ? e.message : 'Unknown error';
          alert(`Could not save the area: ${msg}`);
        }
      }}
    />
  );
}
