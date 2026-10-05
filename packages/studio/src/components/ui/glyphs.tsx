/*
 * The house icon set under the names the borrowed screens already use.
 *
 * Those screens came with lucide-react, so the app drew two icon families side
 * by side: lucide's 2px strokes and square-ish geometry next to the sprite's
 * 1.6 stroke on a 24px grid. Rewriting every call site by hand buys nothing;
 * this maps each name to its sprite glyph, keeps lucide's props (`size`,
 * `className`), and the import path is the only thing a screen changes.
 * New code uses <Icon name="…"> directly.
 */
import type { CSSProperties } from "react";
import { Icon, type IconName } from "./icon";
import { Spinner } from "./working";

interface GlyphProps {
  readonly size?: number | string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly strokeWidth?: number;
  readonly "aria-hidden"?: boolean | "true" | "false";
}

const g = (name: IconName) => {
  const Glyph = ({ size = 16, className }: GlyphProps) => (
    <Icon name={name} size={typeof size === "number" ? size : Number.parseFloat(size) || 16} className={className} />
  );
  Glyph.displayName = name;
  return Glyph;
};

/** The spinner is a working state, not a glyph: one shape everywhere. */
export const Loader2 = ({ className }: GlyphProps) => <Spinner className={className?.replace(/\banimate-spin\b/, "").trim()} />;

export const Activity = g("pulse");
export const AlertCircle = g("info");
export const AlertTriangle = g("alert");
export const ArrowDownToLine = g("down");
export const ArrowLeft = g("arrL");
export const ArrowUp = g("send");
export const BarChart2 = g("chart");
export const Bell = g("bell");
export const Book = g("book");
export const BookCopy = g("copy");
export const BookMarked = g("book");
export const BookPlus = g("book");
export const Bot = g("bot");
export const BotMessageSquare = g("bot");
export const BrainIcon = g("sparkle");
export const Check = g("check");
export const CheckCheck = g("check");
export const CheckCircle2 = g("checkC");
export const CheckCircleIcon = g("checkC");
export const CheckIcon = g("check");
export const ChevronDown = g("chevD");
export const ChevronDownIcon = g("chevD");
export const ChevronLeft = g("chevL");
export const ChevronLeftIcon = g("chevL");
export const ChevronRight = g("chevR");
export const ChevronRightIcon = g("chevR");
export const ChevronUpIcon = g("chevU");
export const CircleIcon = g("dot");
export const Clock = g("clock");
export const ClockIcon = g("clock");
export const CopyIcon = g("copy");
export const CornerDownLeftIcon = g("enter");
export const Cpu = g("cpu");
export const Database = g("database");
export const Download = g("down");
export const ExternalLink = g("external");
export const Eye = g("eye");
export const EyeOff = g("eyeOff");
export const Feather = g("pencil");
export const File = g("file");
export const FileInput = g("file");
export const FileOutput = g("file");
export const FileText = g("file");
export const FolderOpen = g("folder");
export const FolderUp = g("folder");
export const Gamepad2 = g("play");
export const GitFork = g("branch");
export const Hand = g("stop");
export const HardDriveDownload = g("down");
export const History = g("history");
export const ImageIcon = g("image");
export { ImageIcon as Image };
export const Languages = g("globe");
export const Layers = g("layers");
export const Lightbulb = g("bulb");
export const MessageSquare = g("chat");
export const Monitor = g("monitor");
export const Palette = g("drop");
export const PanelRightClose = g("panel");
export const PanelRightOpen = g("panel");
export const Paperclip = g("clip");
export const Pencil = g("pencil");
export const Play = g("play");
export const Plug = g("plug");
export const PlugZap = g("plug");
export const Plus = g("plus");
export const PlusIcon = g("plus");
export const Radar = g("target");
export const RefreshCw = g("redo");
export const RotateCcw = g("history");
export const Save = g("save");
export const Search = g("search");
export const SearchIcon = g("search");
export const Settings2 = g("sliders");
export const ShieldCheck = g("lock");
export const Sparkles = g("sparkle");
export const Square = g("stop");
export const SquareIcon = g("stop");
export const Target = g("target");
export const Trash2 = g("trash");
export const TrendingUp = g("chart");
export const Upload = g("up");
export const Users = g("users");
export const Wand2 = g("sparkle");
export const Wrench = g("tool");
export const WrenchIcon = g("tool");
export const X = g("x");
export const XCircle = g("xC");
export const XCircleIcon = g("xC");
export const XIcon = g("x");
export const Zap = g("bolt");
