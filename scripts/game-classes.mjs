// ClassName добытчиков, лент и труб: порядок лент и труб в каталоге совпадает с порядком upstream.
export const minerClasses = { 'miner-mk1': 'Build_MinerMk1_C', 'miner-mk2': 'Build_MinerMk2_C', 'miner-mk3': 'Build_MinerMk3_C', 'oil-pump': 'Build_OilPump_C', 'water-extractor': 'Build_WaterPump_C' };
export const beltClass = index => `Build_ConveyorBeltMk${index + 1}_C`;
export const pipeClass = index => index ? 'Build_PipelineMK2_C' : 'Build_Pipeline_C';
