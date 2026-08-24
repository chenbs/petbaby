import type { GenerationTask, Pet, Photo, PluginManifest } from "@/domain/models";
import type { StoredObject } from "@/server/storage/types";

export type GeneratorInput = {
  task: GenerationTask;
  pet: Pet;
  photos: Array<{ metadata: Photo; object: StoredObject }>;
  plugin: PluginManifest;
};

export type GeneratorOutput = {
  title: string;
  subtitle: string;
  serialNumber: string;
  authority: string;
  files: Array<{ suffix: string; body: Uint8Array; contentType: string }>;
};
