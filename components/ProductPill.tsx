import { Droplets, Sprout, Mountain } from 'lucide-react';
import { Product } from '@/lib/types';

export function ProductPill({ product }: { product: Product | undefined }) {
  if (!product) return null;
  if (product.type === 'slurry') {
    return <span className="pill pill-slurry"><Droplets size={11} /> {product.name}</span>;
  }
  if (product.type === 'lime') {
    return <span className="pill pill-lime"><Mountain size={11} /> {product.name}</span>;
  }
  return <span className="pill pill-fert"><Sprout size={11} /> {product.name}</span>;
}
