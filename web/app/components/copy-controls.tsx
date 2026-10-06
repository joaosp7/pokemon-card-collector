import { addCopyAction, removeCopyAction } from "@/app/actions";

export function CopyControls({
  slug,
  setId,
  setCardId,
  copies,
}: {
  slug: string;
  setId: number;
  setCardId: string;
  copies: number;
}) {
  const add = addCopyAction.bind(null, slug, setId, setCardId);
  const remove = removeCopyAction.bind(null, slug, setId, setCardId);

  return (
    <div className="mt-2 flex items-center justify-between gap-2 px-0.5">
      <p
        className="font-mono text-sm tabular-nums text-ink-pocket"
        aria-label={`${copies} ${copies === 1 ? "copy" : "copies"}`}
      >
        {copies}
      </p>
      <div className="flex gap-1">
        <form action={add}>
          <button type="submit" className="copy-btn" aria-label="Add copy">
            +
          </button>
        </form>
        <form action={remove}>
          <button
            type="submit"
            className="copy-btn"
            aria-label="Remove copy"
            disabled={copies === 0}
          >
            −
          </button>
        </form>
      </div>
    </div>
  );
}
