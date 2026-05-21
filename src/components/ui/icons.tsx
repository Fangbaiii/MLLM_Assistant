import { forwardRef } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";
import {
  ArrowRight as ArrowRightBase,
  BadgeCheck as BadgeCheckBase,
  Bot as BotBase,
  Brain as BrainBase,
  Check as CheckBase,
  CheckIcon as CheckIconBase,
  ChevronDown as ChevronDownBase,
  ChevronRightIcon as ChevronRightIconBase,
  Clock3 as Clock3Base,
  Copy as CopyBase,
  Eye as EyeBase,
  FileText as FileTextBase,
  FileWarning as FileWarningBase,
  Gauge as GaugeBase,
  ImageIcon as ImageIconBase,
  ImagePlus as ImagePlusBase,
  Layers3 as Layers3Base,
  Loader2 as Loader2Base,
  Menu as MenuBase,
  MessageSquareText as MessageSquareTextBase,
  Moon as MoonBase,
  MoreHorizontal as MoreHorizontalBase,
  PanelRightOpen as PanelRightOpenBase,
  PencilLine as PencilLineBase,
  Pin as PinBase,
  PinOff as PinOffBase,
  Plus as PlusBase,
  RotateCcw as RotateCcwBase,
  ScanLine as ScanLineBase,
  ScanText as ScanTextBase,
  Search as SearchBase,
  SendHorizontal as SendHorizontalBase,
  Settings as SettingsBase,
  ShieldCheck as ShieldCheckBase,
  Sparkles as SparklesBase,
  SunDim as SunDimBase,
  Trash2 as Trash2Base,
  UploadCloud as UploadCloudBase,
  UserRound as UserRoundBase,
  Workflow as WorkflowBase,
  XIcon as XIconBase,
} from "lucide-react";

function withHydrationSafeSvg(Icon: LucideIcon, displayName: string): LucideIcon {
  const WrappedIcon = forwardRef<SVGSVGElement, LucideProps>(function HydrationSafeIcon(props, ref) {
    return <Icon ref={ref} {...props} suppressHydrationWarning />;
  });

  WrappedIcon.displayName = `HydrationSafe(${displayName})`;

  return WrappedIcon as LucideIcon;
}

// Browser extensions like Dark Reader may mutate SVG markup before React hydrates.
export const ArrowRight = withHydrationSafeSvg(ArrowRightBase, "ArrowRight");
export const BadgeCheck = withHydrationSafeSvg(BadgeCheckBase, "BadgeCheck");
export const Bot = withHydrationSafeSvg(BotBase, "Bot");
export const Brain = withHydrationSafeSvg(BrainBase, "Brain");
export const Check = withHydrationSafeSvg(CheckBase, "Check");
export const CheckIcon = withHydrationSafeSvg(CheckIconBase, "CheckIcon");
export const ChevronDown = withHydrationSafeSvg(ChevronDownBase, "ChevronDown");
export const ChevronRightIcon = withHydrationSafeSvg(ChevronRightIconBase, "ChevronRightIcon");
export const Clock3 = withHydrationSafeSvg(Clock3Base, "Clock3");
export const Copy = withHydrationSafeSvg(CopyBase, "Copy");
export const Eye = withHydrationSafeSvg(EyeBase, "Eye");
export const FileText = withHydrationSafeSvg(FileTextBase, "FileText");
export const FileWarning = withHydrationSafeSvg(FileWarningBase, "FileWarning");
export const Gauge = withHydrationSafeSvg(GaugeBase, "Gauge");
export const ImageIcon = withHydrationSafeSvg(ImageIconBase, "ImageIcon");
export const ImagePlus = withHydrationSafeSvg(ImagePlusBase, "ImagePlus");
export const Layers3 = withHydrationSafeSvg(Layers3Base, "Layers3");
export const Loader2 = withHydrationSafeSvg(Loader2Base, "Loader2");
export const Menu = withHydrationSafeSvg(MenuBase, "Menu");
export const MessageSquareText = withHydrationSafeSvg(MessageSquareTextBase, "MessageSquareText");
export const Moon = withHydrationSafeSvg(MoonBase, "Moon");
export const MoreHorizontal = withHydrationSafeSvg(MoreHorizontalBase, "MoreHorizontal");
export const PanelRightOpen = withHydrationSafeSvg(PanelRightOpenBase, "PanelRightOpen");
export const PencilLine = withHydrationSafeSvg(PencilLineBase, "PencilLine");
export const Pin = withHydrationSafeSvg(PinBase, "Pin");
export const PinOff = withHydrationSafeSvg(PinOffBase, "PinOff");
export const Plus = withHydrationSafeSvg(PlusBase, "Plus");
export const RotateCcw = withHydrationSafeSvg(RotateCcwBase, "RotateCcw");
export const ScanLine = withHydrationSafeSvg(ScanLineBase, "ScanLine");
export const ScanText = withHydrationSafeSvg(ScanTextBase, "ScanText");
export const Search = withHydrationSafeSvg(SearchBase, "Search");
export const SendHorizontal = withHydrationSafeSvg(SendHorizontalBase, "SendHorizontal");
export const Settings = withHydrationSafeSvg(SettingsBase, "Settings");
export const ShieldCheck = withHydrationSafeSvg(ShieldCheckBase, "ShieldCheck");
export const Sparkles = withHydrationSafeSvg(SparklesBase, "Sparkles");
export const SunDim = withHydrationSafeSvg(SunDimBase, "SunDim");
export const Trash2 = withHydrationSafeSvg(Trash2Base, "Trash2");
export const UploadCloud = withHydrationSafeSvg(UploadCloudBase, "UploadCloud");
export const UserRound = withHydrationSafeSvg(UserRoundBase, "UserRound");
export const Workflow = withHydrationSafeSvg(WorkflowBase, "Workflow");
export const XIcon = withHydrationSafeSvg(XIconBase, "XIcon");
