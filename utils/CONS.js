exports.UserCategory = [
    "SuperUser",
    "Admin",
    "Supervisor"
];
exports.StatusGeneral = [
    { value: 0, label: 'Created' },
    { value: 1, label: 'Activo' },
    { value: 2, label: 'Inactivo' },
    { value: 3, label: 'Borrado' },
]
exports.Gender = [
    { value: 0, label: 'Masculino' },
    { value: 1, label: 'Femenino' },
    { value: 2, label: 'Otro' },
]

exports.StatusVehicle = [
    {text:'Nuevo', color: '#81D4FA'},
    {text:'Activo',color:'#689F38'},
    {text:'Inactivo',color:'#C62828'},
    {text:'Con Fallas',color:'#FF9100'},
    {text:'En Reparación',color:'#FFEB3B'}
];

exports.BloodType = [
    {label:'O Positivo',value:'1'},
    {label:'O Negativo',value:'2'},
    {label:'A Positivo',value:'3'},
    {label:'A Negativo',value:'4'},
    {label:'B Positivo',value:'5'},
    {label:'B Negativo',value:'6'},
    {label:'AB Positivo',value:'7'},
    {label:'AB Negativo',value:'8'},
 ]

 exports.EndPoint = { 
    //europe
    "ES":"http://ec2-18-118-84-20.us-east-2.compute.amazonaws.com:5000",
    //south america
    "AR":"http://ec2-18-219-5-50.us-east-2.compute.amazonaws.com:5000",
    "UY":"http://ec2-18-219-5-50.us-east-2.compute.amazonaws.com:5000"
}



 exports.osrmService = {
    "AR": "http://ec2-18-219-5-50.us-east-2.compute.amazonaws.com:5000",
    "ES":"ec2-18-118-84-20.us-east-2.compute.amazonaws.com:5000",
    "UY": "http://ec2-13-59-121-117.us-east-2.compute.amazonaws.com:5000"
 }

 exports.nominatimService = {
    //http://ec2-3-22-95-71.us-east-2.compute.amazonaws.com/nominatim/search
    "AR": "http://ec2-3-22-95-71.us-east-2.compute.amazonaws.com/nominatim",
   // "ES":"ec2-18-118-84-20.us-east-2.compute.amazonaws.com:5000",
    "UY": "http://ec2-3-142-249-188.us-east-2.compute.amazonaws.com"
 }

exports.evaluationTypeDescription = {
    'in':'Ingreso de zona',
    'out':'Fuera de zona'
}

exports.statusIncident = [
  { value: 'new', label: 'Nuevo', color: '#3B82F6' }, // Azul
  { value: 'assigned', label: 'Asignado', color: '#6366F1' }, // Índigo
  { value: 'in_progress', label: 'En Progreso', color: '#F59E0B' }, // Ámbar
  { value: 'returned', label: 'Devuelto a Origen', color: '#0EA5E9' },
  { value: 'on_hold', label: 'Observado', color: '#6B7280' }, // Gris
  { value: 'activity', label: 'Actividad', color: '#0EA5E9' }, // Azul claro (similar to returned)
  { value: 'partially_resolved', label: 'Parcialmente Resuelto', color: '#C0E030' }, // Verde-Amarillo intermedio
  { value: 'resolved', label: 'Resuelto', color: '#84CC16' }, // Lima
  { value: 'closed', label: 'Cerrado', color: '#16A34A' },
  { value: 'cancelled', label: 'Cancelado', color: '#EF4444' },
  { value: 'archived', label: 'Archivado', color: '#475569' },
  { value: 'deleted', label: 'Eliminado', color: '#B91C1C' }
]