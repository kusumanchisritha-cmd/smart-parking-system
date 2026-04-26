import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ParkingGrid, type Slot } from "@/components/ParkingGrid";
import { ControlPanel, type Algorithm } from "@/components/ControlPanel";
import {
  ComparisonCards,
  type AlgoResult,
} from "@/components/ComparisonCards";
import { ActivityLog, type LogEntry } from "@/components/ActivityLog";
import { LoadingScreen } from "@/components/LoadingScreen";
import { BackendBanner } from "@/components/BackendBanner";
import {
  parkCar,
  compareAlgorithms,
  getDestination,
  type DestinationId,
} from "@/lib/parkingApi";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ParkingSquare } from "lucide-react";
import { v4 as uuidv4 } from "uuid"; // ✅ FIX ADDED

export const Route = createFileRoute("/")({
  component: Index,
});

const TOTAL_SLOTS = 16;

function initialSlots(): Slot[] {
  return Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
    id: i + 1,
    status: i === 4 || i === 9 ? "occupied" : "available",
    carId: i === 4 ? "CAR-301" : i === 9 ? "CAR-118" : undefined,
  }));
}

function Index() {
  const [booting, setBooting] = useState(true);
  const [backend, setBackend] = useState<"checking" | "online" | "offline">("checking");
  const [slots, setSlots] = useState<Slot[]>(initialSlots);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [greedy, setGreedy] = useState<AlgoResult | null>(null);
  const [dp, setDp] = useState<AlgoResult | null>(null);
  const [loading, setLoading] = useState<"park" | "compare" | null>(null);
  const [activeDest, setActiveDest] = useState<DestinationId>("main_entrance");
  const [pathSlot, setPathSlot] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 350);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);

    fetch("https://smart-parking-backend-c90k.onrender.com/")
      .then(() => setBackend("online"))
      .catch(() => setBackend("offline"))
      .finally(() => clearTimeout(timer));

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, []);

  const available = useMemo(
    () => slots.filter((s) => s.status === "available").map((s) => s.id),
    [slots],
  );

  const stats = useMemo(() => {
    const occ = slots.filter((s) => s.status !== "available").length;
    return { occ, total: slots.length, free: slots.length - occ };
  }, [slots]);

  // ✅ FIXED HERE
  const addLog = (message: string) => {
    setLogs((prev) =>
      [
        {
          id: uuidv4(), // ✅ FIXED
          time: new Date().toLocaleTimeString(),
          message,
        },
        ...prev,
      ].slice(0, 50),
    );
  };

  const handlePark = async (
    carId: string,
    algorithm: Algorithm,
    destination: DestinationId,
  ) => {
    setLoading("park");
    setActiveDest(destination);
    try {
      const res = await parkCar(carId, algorithm, available, destination);

      setPathSlot(res.slot);

      setSlots((prev) =>
        prev.map((s) =>
          s.id === res.slot ? { ...s, status: "selected", carId } : s,
        ),
      );

      setTimeout(() => {
        setSlots((prev) =>
          prev.map((s) =>
            s.id === res.slot ? { ...s, status: "occupied", carId } : s,
          ),
        );
      }, 900);

      addLog(`Car ${carId} parked in Slot ${res.slot}`);
      toast.success(`Parked in Slot ${res.slot}`);
    } catch (e) {
      toast.error("Failed to park");
    } finally {
      setLoading(null);
    }
  };

  const handleCompare = async (carId: string, destination: DestinationId) => {
    setLoading("compare");
    setActiveDest(destination);

    try {
      const res = await compareAlgorithms(carId, available, destination);

      setGreedy(res.greedy);
      setDp(res.dp);
      setPathSlot(res.dp.slot);

      addLog(`Compared parking for ${carId}`);
      toast.success("Comparison done");
    } catch (e) {
      toast.error("Compare failed");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div>
      {booting && <LoadingScreen message="Loading..." />}
      <Toaster />
      <BackendBanner status={backend} />

      <ControlPanel onPark={handlePark} onCompare={handleCompare} loading={loading} />
      <ParkingGrid slots={slots} destination={getDestination(activeDest)} pathSlotId={pathSlot} />
      <ComparisonCards greedy={greedy} dp={dp} />
      <ActivityLog entries={logs} />
    </div>
  );
}