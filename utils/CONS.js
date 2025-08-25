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

exports.evaluationTypeDescription = {
    'in':'Ingreso de zona',
    'out':'Fuera de zona'
}
