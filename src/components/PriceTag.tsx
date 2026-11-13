import { formatINR } from '../lib/money';

// Shows a price; when a sale applies, also the original price crossed out and the sale's name (e.g. "Diwali Sale").
export default function PriceTag({ price, compareAt, saleName }: { price: number | string; compareAt?: number | string | null; saleName?: string | null }) {
  const onSale = compareAt != null && Number(compareAt) > Number(price);
  return (
    <span>
      {onSale && <span className="line-through text-textSecondary/70 mr-2 font-normal">₹{formatINR(compareAt as number)}</span>}
      <span>₹{formatINR(price)}</span>
      {onSale && saleName && (
        <span className="ml-2 inline-block text-[10px] uppercase tracking-[1px] bg-black text-white rounded-full px-2 py-0.5 align-middle font-normal">{saleName}</span>
      )}
    </span>
  );
}
