import { describe, expect, it } from "vitest";
import { shiftClocksInText, stitchSegments } from "@/lib/segment-stitch";
import { assignCycles, buildStationStudies, elementTypeOf, normalizeStation } from "@/lib/time-study";
import type { MovementTiming, VideoAnalysis } from "@/types/activity";

const cycle = (station: string, start: string, end: string, durationSeconds: number, status: MovementTiming["status"] = "complete"): MovementTiming => ({
  name: "Ciclo completo",
  station,
  elementType: "ciclo",
  status,
  startTime: start,
  endTime: end,
  durationSeconds,
});

const leaf = (
  station: string,
  name: string,
  elementType: MovementTiming["elementType"],
  start: string,
  end: string,
  durationSeconds: number,
): MovementTiming => ({ name, station, elementType, status: "complete", startTime: start, endTime: end, durationSeconds });

function video(movements: MovementTiming[]): VideoAnalysis {
  return { videoId: "v1", fileName: "1.MOV", movements, totalDurationSeconds: 0 };
}

describe("assignCycles", () => {
  it("numera ciclos por posto e liga cada elemento ao ciclo que o contém", () => {
    const result = assignCycles([
      cycle("Posto 1", "00:00.00", "00:10.00", 10),
      leaf("Posto 1", "Pegar painel", "repetitivo", "00:00.00", "00:02.50", 2.5),
      cycle("Posto 2", "00:01.00", "00:05.00", 4),
      leaf("Posto 2", "Alimentar esteira", "repetitivo", "00:01.00", "00:03.00", 2),
      cycle("Posto 1", "00:10.00", "00:20.00", 10),
      leaf("Posto 1", "Pegar painel", "repetitivo", "00:10.00", "00:12.25", 2.25),
      leaf("Posto 1", "Conversa", "estranho", "00:30.00", "01:30.00", 60),
    ]);
    expect(result.map((movement) => movement.cycle)).toEqual([1, 1, 1, 1, 2, 2, null]);
  });

  it("lê o número do ciclo nas notas de relatórios antigos", () => {
    const [movement] = assignCycles([{ name: "Pega", startTime: "00:01", endTime: "00:03", durationSeconds: 2, notes: "Ciclo 4. Pega." }]);
    expect(movement.cycle).toBe(4);
    expect(movement.station).toBe("Sem posto");
  });
});

describe("buildStationStudies", () => {
  const studies = buildStationStudies([
    video([
      cycle("Posto 1", "00:00.00", "00:10.00", 10),
      leaf("Posto 1", "Pegar painel", "repetitivo", "00:00.00", "00:02.00", 2),
      leaf("Posto 1", "Colocar painel", "repetitivo", "00:02.00", "00:05.00", 3),
      leaf("Posto 1", "Trocar pilha", "casual", "00:05.00", "00:09.00", 4),
      leaf("Posto 1", "Aguardar painel", "espera", "00:09.00", "00:10.00", 1),
      cycle("Posto 1", "00:10.00", "00:20.00", 10),
      leaf("Posto 1", "Pegar painel", "repetitivo", "00:10.00", "00:13.00", 3),
      leaf("Posto 1", "Colocar painel", "repetitivo", "00:13.00", "00:16.00", 3),
      leaf("Posto 1", "Aguardar painel", "espera", "00:16.00", "00:20.00", 4),
      leaf("Posto 1", "Conversa com supervisor", "estranho", "00:20.00", "00:50.00", 30),
      cycle("Posto 2", "00:00.00", "00:04.00", 4),
      leaf("Posto 2", "Alimentar esteira", "repetitivo", "00:00.00", "00:04.00", 4),
      { ...cycle("Posto 2", "00:50.00", "00:52.00", 2, "partial") },
    ]),
  ]);
  const posto1 = studies.find((study) => study.station === "Posto 1")!;

  it("separa os postos sem misturar elementos", () => {
    expect(studies.map((study) => study.station)).toEqual(["Posto 1", "Posto 2"]);
    expect(posto1.elements.map((element) => element.name)).not.toContain("Alimentar esteira");
  });

  it("usa 0 nos ciclos em que o elemento não ocorre", () => {
    const casual = posto1.elements.find((element) => element.name === "Trocar pilha")!;
    expect(casual.readings).toEqual([4, 0]);
    expect(casual.mean).toBe(2);
    expect(casual.stdDev).toBeCloseTo(Math.SQRT2 * 2, 6);
    expect(casual.cyclesPerOccurrence).toBe(2);
  });

  it("calcula erro a 95% e n necessário para erro de 5%", () => {
    const pick = posto1.elements.find((element) => element.name === "Pegar painel")!;
    const sd = Math.sqrt(0.5);
    expect(pick.mean).toBe(2.5);
    expect(pick.stdDev).toBeCloseTo(sd, 6);
    expect(pick.relativeError).toBeCloseTo((1.96 * sd) / (Math.sqrt(2) * 2.5), 6);
    expect(pick.requiredSamples).toBe(Math.ceil(((1.96 * sd) / (0.05 * 2.5)) ** 2));
  });

  it("soma repetitivos e casuais no ciclo de trabalho e separa esperas e estranhos", () => {
    expect(posto1.cycleCount).toBe(2);
    expect(posto1.workCycleSeconds).toBeCloseTo(2.5 + 3 + 2, 6);
    expect(posto1.waits.totalSeconds).toBe(5);
    expect(posto1.foreign).toMatchObject({ occurrences: 1, totalSeconds: 30, meanPerOccurrence: 30, meanPerCycle: 0 });
    expect(posto1.observedCycle).toMatchObject({ mean: 10, count: 2 });
  });

  it("deixa ciclo parcial fora da amostra", () => {
    const posto2 = studies.find((study) => study.station === "Posto 2")!;
    expect(posto2.cycleCount).toBe(1);
    expect(posto2.partialCycles).toBe(1);
  });
});

describe("normalização", () => {
  it("padroniza o nome do posto", () => {
    expect(normalizeStation("posto 02")).toBe("Posto 2");
    expect(normalizeStation("P3")).toBe("Posto 3");
    expect(normalizeStation("")).toBe("Sem posto");
  });

  it("infere o tipo de relatórios antigos pelo nome", () => {
    expect(elementTypeOf({ name: "Tempo ocioso", startTime: "", endTime: "", durationSeconds: 1 })).toBe("espera");
    expect(elementTypeOf({ name: "Ciclo completo", startTime: "", endTime: "", durationSeconds: 1 })).toBe("ciclo");
  });
});

describe("stitchSegments", () => {
  it("mantém centésimos, une só o mesmo elemento do mesmo posto e corrige horários nas notas", () => {
    const stitched = stitchSegments([
      {
        index: 0,
        startSeconds: 0,
        endSeconds: 300,
        overlapSeconds: 0,
        movements: [
          leaf("Posto 1", "Pegar painel", "repetitivo", "04:58.40", "05:00.00", 1.6),
          leaf("Posto 2", "Pegar painel", "repetitivo", "04:59.00", "05:00.00", 1),
        ],
      },
      {
        index: 1,
        startSeconds: 292,
        endSeconds: 592,
        overlapSeconds: 8,
        movements: [
          { ...leaf("Posto 1", "Pegar painel", "repetitivo", "00:08.00", "00:09.15", 1.15) },
          { ...leaf("Posto 1", "Conversa", "estranho", "00:20.00", "00:50.00", 30), notes: "Conversa com a qualidade (00:25-00:40)" },
        ],
      },
    ]);
    const posto1 = stitched.movements.filter((movement) => movement.station === "Posto 1");
    expect(posto1[0]).toMatchObject({ startTime: "04:58.40", endTime: "05:01.15", durationSeconds: 2.75 });
    expect(stitched.movements.filter((movement) => movement.station === "Posto 2")).toHaveLength(1);
    expect(posto1[1].notes).toBe("Conversa com a qualidade (05:17-05:32)");
  });

  it("não desloca horários que já estão no relógio do vídeo", () => {
    expect(shiftClocksInText("Parada às 12:30", 292, 300)).toBe("Parada às 12:30");
  });
});
